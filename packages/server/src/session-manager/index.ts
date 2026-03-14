import type { SessionUpdate } from "@matrix/protocol";
import type { AcpBridge } from "../acp-bridge/index.js";
import type { AgentManager } from "../agent-manager/index.js";
import type { Store } from "../store/index.js";
import type { ConnectionManager } from "../api/ws/connection-manager.js";

const MAX_RESTART_ATTEMPTS = 3;
const BASE_RESTART_DELAY_MS = 1000;

export interface SessionBridgeFactory {
  (
    sessionId: string,
    agentId: string,
    cwd: string,
    restoreAgentSessionId?: string | null,
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
      console.log(
        `[session ${sessionId}] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached, closing session`,
      );
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

    console.log(
      `[session ${sessionId}] Agent crashed, restarting (attempt ${attempt}/${MAX_RESTART_ATTEMPTS}) in ${delayMs}ms`,
    );

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
      console.error(`[session ${sessionId}] No bridge factory configured, cannot restart`);
      this.sessions.delete(sessionId);
      store.closeSession(sessionId);
      return;
    }

    try {
      const { bridge } = await this.bridgeFactory(sessionId, entry.agentId, entry.cwd);
      entry.bridge = bridge;
      // Reset restart attempts on successful restart
      entry.restartAttempts = 0;
      console.log(`[session ${sessionId}] Agent restarted successfully`);
    } catch (err) {
      console.error(`[session ${sessionId}] Failed to restart agent:`, err);

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

    if (!this.bridgeFactory) {
      return null;
    }

    const session = store.getSession(sessionId);
    if (
      !session
      || session.status !== "suspended"
      || !session.recoverable
      || !session.agentSessionId
    ) {
      return null;
    }

    const promise = (async () => {
      store.updateSessionState(sessionId, {
        status: "restoring",
        suspendedAt: null,
        closeReason: null,
      });

      try {
        const { bridge, agentSessionId } = await this.bridgeFactory(
          sessionId,
          session.agentId,
          session.cwd,
          session.agentSessionId,
        );
        this.register(sessionId, bridge, session.agentId, session.cwd);
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

  suspendIdleSessions(store: Store, nowMs: number, idleTimeoutMs: number): void {
    const cutoffMs = nowMs - idleTimeoutMs;

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

      entry.explicitlyClosed = true;
      if (entry.restartTimer) {
        clearTimeout(entry.restartTimer);
      }
      this.sessions.delete(session.sessionId);
      entry.bridge.destroy();
      store.updateSessionState(session.sessionId, {
        status: "suspended",
        suspendedAt: new Date(nowMs).toISOString(),
        closeReason: null,
      });
    }
  }
}
