import type { SessionUpdate } from "@matrix/protocol";
import type { AcpBridge } from "../acp-bridge/index.js";
import type { AgentManager } from "../agent-manager/index.js";
import type { Store } from "../store/index.js";
import type { ConnectionManager } from "../api/ws/connection-manager.js";
import { logger } from "../logger.js";

const log = logger.child({ target: "session-manager" });

const MAX_RESTART_ATTEMPTS = 3;
const BASE_RESTART_DELAY_MS = 1000;

export interface SessionBridgeFactory {
  (
    sessionId: string,
    agentId: string,
    cwd: string,
    restoreAgentSessionId?: string | null,
    profileId?: string,
  ): Promise<{
    bridge: AcpBridge;
    modes: { currentModeId: string; availableModes: unknown[] };
    recoverable?: boolean;
    agentSessionId?: string | null;
  }>;
}

interface SessionEntry {
  bridge: AcpBridge;
  agentId: string;
  cwd: string;
  explicitlyClosed: boolean;
  restartAttempts: number;
  activePromptCount: number;
  restartTimer?: ReturnType<typeof setTimeout>;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  private bridgeFactory: SessionBridgeFactory | null = null;
  private restorePromises = new Map<string, Promise<AcpBridge | null>>();

  /**
   * Register the factory that creates AcpBridge instances.
   * This is called once during server setup to inject the creation logic.
   */
  setBridgeFactory(factory: SessionBridgeFactory): void {
    this.bridgeFactory = factory;
  }

  /**
   * Track a newly created session.
   */
  register(sessionId: string, bridge: AcpBridge, agentId: string, cwd: string): void {
    this.sessions.set(sessionId, {
      bridge,
      agentId,
      cwd,
      explicitlyClosed: false,
      restartAttempts: 0,
      activePromptCount: 0,
    });
  }

  /**
   * Get the bridge for a session.
   */
  getBridge(sessionId: string): AcpBridge | undefined {
    return this.sessions.get(sessionId)?.bridge;
  }

  /**
   * Mark a session as explicitly closed (user-initiated delete).
   * Kills the agent process, removes from tracking, and updates the store.
   */
  closeSession(sessionId: string, store: Store): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.explicitlyClosed = true;
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
      }
      entry.bridge.destroy();
      this.sessions.delete(sessionId);
    }
    store.closeSession(sessionId);
  }

  /**
   * Called when an agent process closes. If not explicitly closed,
   * attempts auto-restart with exponential backoff.
   */
  handleAgentClose(
    sessionId: string,
    store: Store,
    connectionManager: ConnectionManager,
  ): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    // If the session was explicitly deleted, don't restart
    if (entry.explicitlyClosed) {
      return;
    }

    // Check if we can still restart
    if (entry.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log.info({ sessionId }, "max restart attempts reached, closing session");
      connectionManager.broadcastToSession(sessionId, {
        type: "session:closed",
        sessionId,
        reason: "max_restarts_exceeded",
      } as any);
      this.sessions.delete(sessionId);
      store.closeSession(sessionId);
      return;
    }

    // Attempt restart with exponential backoff
    const attempt = entry.restartAttempts + 1;
    const delayMs = BASE_RESTART_DELAY_MS * Math.pow(2, entry.restartAttempts);

    log.info({ sessionId, attempt, maxAttempts: MAX_RESTART_ATTEMPTS, delayMs }, "agent crashed, restarting");

    connectionManager.broadcastToSession(sessionId, {
      type: "session:agent_restarting",
      sessionId,
      attempt,
      maxAttempts: MAX_RESTART_ATTEMPTS,
    } as any);

    entry.restartAttempts = attempt;
    entry.restartTimer = setTimeout(async () => {
      await this.restartAgent(sessionId, store, connectionManager);
    }, delayMs);
  }

  private async restartAgent(
    sessionId: string,
    store: Store,
    connectionManager: ConnectionManager,
  ): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.explicitlyClosed) return;

    if (!this.bridgeFactory) {
      log.error({ sessionId }, "no bridge factory configured, cannot restart");
      this.sessions.delete(sessionId);
      store.closeSession(sessionId);
      return;
    }

    try {
      const { bridge } = await this.bridgeFactory(sessionId, entry.agentId, entry.cwd);
      entry.bridge = bridge;
      // Reset restart attempts on successful restart
      entry.restartAttempts = 0;
      log.info({ sessionId }, "agent restarted");
    } catch (err) {
      log.error({ sessionId, err }, "restart failed");

      // Recursively call handleAgentClose to retry or give up
      this.handleAgentClose(sessionId, store, connectionManager);
    }
  }

  /**
   * Check if a session was explicitly closed (used by onClose handler to decide behavior).
   */
  isExplicitlyClosed(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    return entry?.explicitlyClosed ?? true; // default to true if not found (already removed)
  }

  /**
   * Check if a session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  cancelPrompt(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    entry?.bridge.cancelPrompt(sessionId);
  }

  markPromptStarted(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.activePromptCount += 1;
  }

  markPromptCompleted(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.activePromptCount = Math.max(0, entry.activePromptCount - 1);
  }

  async restoreSession(sessionId: string, store: Store): Promise<AcpBridge | null> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing.bridge;
    }

    const pending = this.restorePromises.get(sessionId);
    if (pending) {
      return pending;
    }

    const factory = this.bridgeFactory;
    if (!factory) {
      return null;
    }

    const session = store.getSession(sessionId);
    if (
      !session
      || !session.agentId
      || !session.recoverable
      || !session.agentSessionId
    ) {
      return null;
    }

    const promise = (async () => {
      try {
        const { bridge, agentSessionId } = await factory(
          sessionId,
          session.agentId!,
          session.cwd,
          session.agentSessionId,
          session.profileId ?? undefined,
        );
        this.register(sessionId, bridge, session.agentId!, session.cwd);
        store.updateSessionState(sessionId, {
          status: "active",
          agentSessionId: agentSessionId ?? bridge.agentSessionId,
          suspendedAt: null,
          closeReason: null,
        });
        store.touchSession(sessionId);
        return bridge;
      } catch {
        store.updateSessionState(sessionId, {
          status: "closed",
          suspendedAt: null,
          closeReason: "restore_failed",
        });
        return null;
      } finally {
        this.restorePromises.delete(sessionId);
      }
    })();

    this.restorePromises.set(sessionId, promise);
    return promise;
  }

  /** Clear all pending restart timers (for test cleanup). */
  clearAllTimers(): void {
    for (const entry of this.sessions.values()) {
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
        entry.restartTimer = undefined;
      }
    }
  }

  /**
   * Reclaim resources for idle sessions by killing agent bridges.
   * Sessions remain "active" — agents are lazily restored on next prompt.
   */
  suspendIdleSessions(store: Store, nowMs: number, idleTimeoutMs: number): string[] {
    const cutoffMs = nowMs - idleTimeoutMs;
    const suspendedIds: string[] = [];

    for (const session of store.listSessions()) {
      if (session.status !== "active" || !session.recoverable) {
        continue;
      }

      const entry = this.sessions.get(session.sessionId);
      if (!entry) {
        continue;
      }

      if (entry.activePromptCount > 0) {
        continue;
      }

      const lastActiveMs = Date.parse(session.lastActiveAt);
      if (Number.isNaN(lastActiveMs) || lastActiveMs > cutoffMs) {
        continue;
      }

      // Kill the bridge to reclaim resources, but keep session active
      entry.explicitlyClosed = true;
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
      }
      this.sessions.delete(session.sessionId);
      entry.bridge.destroy();
      store.updateSessionState(session.sessionId, {
        suspendedAt: new Date(nowMs).toISOString(),
      });
      suspendedIds.push(session.sessionId);
    }

    return suspendedIds;
  }
}
