import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager } from "../session-manager/index.js";
import { Store } from "../store/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-session-manager-test.db";

function createMockBridge() {
  return {
    destroy: vi.fn(),
    sendPrompt: vi.fn(),
    respondPermission: vi.fn(),
    initialize: vi.fn().mockResolvedValue({}),
    createSession: vi.fn().mockResolvedValue({ modes: { currentModeId: "code", availableModes: [] } }),
    request: vi.fn(),
    notify: vi.fn(),
  } as any;
}

describe("SessionManager", () => {
  let sessionManager: SessionManager;
  let store: Store;
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
    sessionManager = new SessionManager();
    store = new Store(DB_PATH);
    connectionManager = new ConnectionManager();
  });

  afterEach(() => {
    sessionManager.clearAllTimers();
    vi.useRealTimers();
    store.close();
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
  });

  describe("register and getBridge", () => {
    it("registers a session and retrieves its bridge", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      expect(sessionManager.getBridge("sess_1")).toBe(bridge);
    });

    it("returns undefined for unknown session", () => {
      expect(sessionManager.getBridge("unknown")).toBeUndefined();
    });

    it("has() returns true for registered sessions", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      expect(sessionManager.has("sess_1")).toBe(true);
      expect(sessionManager.has("unknown")).toBe(false);
    });
  });

  describe("closeSession (explicit delete)", () => {
    it("calls bridge.destroy() and removes from tracking", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      sessionManager.closeSession("sess_1", store);

      expect(bridge.destroy).toHaveBeenCalledOnce();
      expect(sessionManager.getBridge("sess_1")).toBeUndefined();
      expect(sessionManager.has("sess_1")).toBe(false);

      // Store should mark session as closed
      const sessions = store.listSessions();
      expect(sessions[0].status).toBe("closed");
    });

    it("clears pending restart timer on explicit close", () => {
      vi.useFakeTimers();

      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      // Trigger an agent crash to start auto-restart
      sessionManager.handleAgentClose("sess_1", store, connectionManager);

      // Now explicitly close before the restart fires
      sessionManager.closeSession("sess_1", store);

      expect(bridge.destroy).toHaveBeenCalledOnce();
      expect(sessionManager.has("sess_1")).toBe(false);

      vi.useRealTimers();
    });

    it("handles closing a non-existent session gracefully", () => {
      store.createSession("sess_1", "agent-1", "/tmp");
      // Should not throw
      sessionManager.closeSession("sess_1", store);
      const sessions = store.listSessions();
      expect(sessions[0].status).toBe("closed");
    });
  });

  describe("handleAgentClose (auto-restart)", () => {
    it("broadcasts session:agent_restarting on unexpected close", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      const messages: any[] = [];
      connectionManager.onMessage((msg) => messages.push(msg));

      // Add a subscriber so broadcast works
      connectionManager.addConnection("conn1", { send: vi.fn() });
      connectionManager.subscribeToSession("conn1", "sess_1");

      sessionManager.handleAgentClose("sess_1", store, connectionManager);

      // Should have broadcast agent_restarting
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("session:agent_restarting");
      expect(messages[0].sessionId).toBe("sess_1");
      expect(messages[0].attempt).toBe(1);
      expect(messages[0].maxAttempts).toBe(3);
    });

    it("does not restart if session was explicitly closed", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      // Explicitly close
      sessionManager.closeSession("sess_1", store);

      const messages: any[] = [];
      connectionManager.onMessage((msg) => messages.push(msg));

      // This should be a no-op since session is already removed
      sessionManager.handleAgentClose("sess_1", store, connectionManager);

      expect(messages).toHaveLength(0);
    });

    it("broadcasts session:closed after max restart attempts", () => {
      vi.useFakeTimers();

      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      const messages: any[] = [];
      connectionManager.onMessage((msg) => messages.push(msg));
      connectionManager.addConnection("conn1", { send: vi.fn() });
      connectionManager.subscribeToSession("conn1", "sess_1");

      // Exhaust all restart attempts
      sessionManager.handleAgentClose("sess_1", store, connectionManager); // attempt 1
      sessionManager.handleAgentClose("sess_1", store, connectionManager); // attempt 2
      sessionManager.handleAgentClose("sess_1", store, connectionManager); // attempt 3

      // 4th call should exceed max
      sessionManager.handleAgentClose("sess_1", store, connectionManager);

      const closedMessages = messages.filter((m) => m.type === "session:closed");
      expect(closedMessages).toHaveLength(1);
      expect(closedMessages[0].reason).toBe("max_restarts_exceeded");

      // Session should be removed
      expect(sessionManager.has("sess_1")).toBe(false);

      // Store should show closed
      const sessions = store.listSessions();
      expect(sessions[0].status).toBe("closed");

      vi.useRealTimers();
    });

    it("uses exponential backoff for restart delays", async () => {
      vi.useFakeTimers();

      const newBridge = createMockBridge();
      sessionManager.setBridgeFactory(async () => ({
        bridge: newBridge,
        modes: { currentModeId: "code", availableModes: [] },
      }));

      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      connectionManager.addConnection("conn1", { send: vi.fn() });
      connectionManager.subscribeToSession("conn1", "sess_1");

      // First crash
      sessionManager.handleAgentClose("sess_1", store, connectionManager);

      // Before delay (1000ms), bridge should not be replaced
      vi.advanceTimersByTime(500);
      expect(sessionManager.getBridge("sess_1")).toBe(bridge);

      // After delay, bridge should be replaced
      vi.advanceTimersByTime(600);
      // Flush microtasks so async restartAgent completes
      await new Promise(resolve => queueMicrotask(resolve));
      await new Promise(resolve => queueMicrotask(resolve));
      expect(sessionManager.getBridge("sess_1")).toBe(newBridge);

      vi.useRealTimers();
    });

    it("resets restart attempts after successful restart", async () => {
      vi.useFakeTimers();

      const newBridge = createMockBridge();
      sessionManager.setBridgeFactory(async () => ({
        bridge: newBridge,
        modes: { currentModeId: "code", availableModes: [] },
      }));

      const bridge = createMockBridge();
      sessionManager.register("sess_1", bridge, "agent-1", "/tmp");
      store.createSession("sess_1", "agent-1", "/tmp");

      connectionManager.addConnection("conn1", { send: vi.fn() });
      connectionManager.subscribeToSession("conn1", "sess_1");

      // First crash + successful restart
      sessionManager.handleAgentClose("sess_1", store, connectionManager);
      vi.advanceTimersByTime(1100);
      // Flush microtasks so async restartAgent completes
      await new Promise(resolve => queueMicrotask(resolve));
      await new Promise(resolve => queueMicrotask(resolve));

      // After successful restart, another crash should be attempt 1 again
      const messages: any[] = [];
      connectionManager.onMessage((msg) => messages.push(msg));

      const anotherBridge = createMockBridge();
      sessionManager.setBridgeFactory(async () => ({
        bridge: anotherBridge,
        modes: { currentModeId: "code", availableModes: [] },
      }));

      sessionManager.handleAgentClose("sess_1", store, connectionManager);
      const restartMsg = messages.find((m) => m.type === "session:agent_restarting");
      expect(restartMsg.attempt).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("idle suspension", () => {
    it("suspends an idle recoverable active session", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_idle", bridge, "agent-1", "/tmp");
      store.createSession("sess_idle", "agent-1", "/tmp", {
        recoverable: true,
        lastActiveAt: "2026-03-14T00:00:00.000Z",
      });

      sessionManager.suspendIdleSessions(
        store,
        Date.parse("2026-03-14T00:31:00.000Z"),
        30 * 60 * 1000,
      );

      expect(bridge.destroy).toHaveBeenCalledOnce();
      expect(sessionManager.has("sess_idle")).toBe(false);
      // Session stays active — agent bridge is killed but session remains active for lazy restore
      expect(store.getSession("sess_idle")?.status).toBe("active");
      expect(store.getSession("sess_idle")?.suspendedAt).toBe("2026-03-14T00:31:00.000Z");
    });

    it("does not suspend non-recoverable sessions", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_nonrecoverable", bridge, "agent-1", "/tmp");
      store.createSession("sess_nonrecoverable", "agent-1", "/tmp", {
        recoverable: false,
        lastActiveAt: "2026-03-14T00:00:00.000Z",
      });

      sessionManager.suspendIdleSessions(
        store,
        Date.parse("2026-03-14T00:31:00.000Z"),
        30 * 60 * 1000,
      );

      expect(bridge.destroy).not.toHaveBeenCalled();
      expect(sessionManager.has("sess_nonrecoverable")).toBe(true);
      expect(store.getSession("sess_nonrecoverable")?.status).toBe("active");
    });

    it("does not suspend sessions that are not idle long enough", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_recent", bridge, "agent-1", "/tmp");
      store.createSession("sess_recent", "agent-1", "/tmp", {
        recoverable: true,
        lastActiveAt: "2026-03-14T00:20:00.000Z",
      });

      sessionManager.suspendIdleSessions(
        store,
        Date.parse("2026-03-14T00:31:00.000Z"),
        30 * 60 * 1000,
      );

      expect(bridge.destroy).not.toHaveBeenCalled();
      expect(sessionManager.has("sess_recent")).toBe(true);
      expect(store.getSession("sess_recent")?.status).toBe("active");
    });

    it("does not suspend sessions with an in-flight prompt", () => {
      const bridge = createMockBridge();
      sessionManager.register("sess_inflight", bridge, "agent-1", "/tmp");
      store.createSession("sess_inflight", "agent-1", "/tmp", {
        recoverable: true,
        lastActiveAt: "2026-03-14T00:00:00.000Z",
      });

      sessionManager.markPromptStarted("sess_inflight");
      sessionManager.suspendIdleSessions(
        store,
        Date.parse("2026-03-14T00:31:00.000Z"),
        30 * 60 * 1000,
      );

      expect(bridge.destroy).not.toHaveBeenCalled();
      expect(sessionManager.has("sess_inflight")).toBe(true);
      expect(store.getSession("sess_inflight")?.status).toBe("active");
    });
  });

  describe("DELETE /sessions/:id integration", () => {
    it("kills bridge and updates store when session is deleted via REST", async () => {
      const { Hono } = await import("hono");
      const { createRestRoutes } = await import("../api/rest/index.js");
      const { AgentManager } = await import("../agent-manager/index.js");
      const { WorktreeManager } = await import("../worktree-manager/index.js");

      const agentManager = new AgentManager();
      agentManager.register({ id: "test-agent", name: "Test", command: "echo", args: [] });

      const app = new Hono();
      app.route("/", createRestRoutes({
        agentManager,
        store,
        sessionManager,
        worktreeManager: new WorktreeManager(),
        createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
      }));

      const bridge = createMockBridge();
      store.createSession("sess_1", "test-agent", "/tmp");
      sessionManager.register("sess_1", bridge, "test-agent", "/tmp");

      const res = await app.request("/sessions/sess_1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      // Bridge should be destroyed
      expect(bridge.destroy).toHaveBeenCalledOnce();

      // Session should no longer be tracked
      expect(sessionManager.has("sess_1")).toBe(false);

      // Store should no longer contain the session
      const sessions = store.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });
});
