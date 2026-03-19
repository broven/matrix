import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { createTransportRoutes } from "../api/transport/index.js";
import { authMiddleware } from "../auth/middleware.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync } from "node:fs";
import { vi } from "vitest";

const DB_PATH = "/tmp/matrix-integration-lifecycle.db";
const TOKEN = "test-token-lifecycle";

describe("Integration: session lifecycle", () => {
  let app: Hono;
  let store: Store;
  let connectionManager: ConnectionManager;
  let promptsReceived: Array<{ sessionId: string; prompt: Array<{ type: string; text: string }> }>;

  beforeEach(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      try { unlinkSync(DB_PATH + ext); } catch {}
    }
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });

    store = new Store(DB_PATH);
    connectionManager = new ConnectionManager();
    promptsReceived = [];

    app = new Hono();
    app.use("/agents/*", authMiddleware(TOKEN));
    app.use("/sessions/*", authMiddleware(TOKEN));

    const sessionManager = new SessionManager();
    app.route("/", createRestRoutes({
      agentManager,
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken: TOKEN,
        snapshotProvider: (sessionId?: string) => {
          const sessions = store
            .listSessions()
            .filter((s) => s.status === "active")
            .filter((s) => !sessionId || s.sessionId === sessionId);

          return sessions.map((s) => ({
            type: "session:snapshot" as const,
            sessionId: s.sessionId,
            history: store.getHistory(s.sessionId),
            eventId: String(connectionManager.getCurrentEventId()),
          }));
        },
        onPrompt(sessionId, prompt) {
          promptsReceived.push({ sessionId, prompt });
        },
        onCancel: () => {},
        onPermissionResponse: () => {},
      }),
    );
  });

  afterEach(() => {
    store.close();
    for (const ext of ["", "-wal", "-shm"]) {
      try { unlinkSync(DB_PATH + ext); } catch {}
    }
  });

  const authHeaders = { Authorization: `Bearer ${TOKEN}` };

  it("full lifecycle: create session, prompt, receive updates, get history, delete", async () => {
    // 1. Create session in the store directly (since POST /sessions needs AcpBridge)
    store.createSession("sess_lifecycle", "test-agent", "/tmp/project");

    // 2. Verify session appears in list
    const listRes = await app.request("/sessions", { headers: authHeaders });
    expect(listRes.status).toBe(200);
    const sessions = await listRes.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("sess_lifecycle");
    expect(sessions[0].status).toBe("active");

    // 3. Send a prompt via POST /messages
    const promptRes = await app.request("/messages", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_lifecycle",
        prompt: [{ type: "text", text: "hello agent" }],
      }),
    });
    expect(promptRes.status).toBe(202);
    expect(promptsReceived).toHaveLength(1);
    expect(promptsReceived[0].sessionId).toBe("sess_lifecycle");
    expect(promptsReceived[0].prompt[0].text).toBe("hello agent");

    // 4. Simulate agent sending updates via connectionManager
    store.appendHistory("sess_lifecycle", "user", "hello agent");
    connectionManager.broadcastToSession("sess_lifecycle", {
      type: "session:update",
      sessionId: "sess_lifecycle",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello! I can help." },
      },
      eventId: "",
    });
    store.appendHistory("sess_lifecycle", "agent", "Hello! I can help.");

    // 5. Verify history is retrievable
    const historyRes = await app.request("/sessions/sess_lifecycle/history", {
      headers: authHeaders,
    });
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("hello agent");
    expect(history[1].role).toBe("agent");
    expect(history[1].content).toBe("Hello! I can help.");

    // 6. Poll for events
    const pollRes = await app.request("/poll?lastEventId=0", {
      headers: authHeaders,
    });
    expect(pollRes.status).toBe(200);
    const events = await pollRes.json();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("session:update");

    // 7. Delete the session
    const deleteRes = await app.request("/sessions/sess_lifecycle", {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(deleteRes.status).toBe(200);

    // 8. Verify session is deleted
    const finalListRes = await app.request("/sessions", { headers: authHeaders });
    const finalSessions = await finalListRes.json();
    expect(finalSessions).toHaveLength(0);
  });

  it("restores a suspended recoverable session before forwarding the prompt", async () => {
    const restoreCalls: string[] = [];
    const sendPrompt = vi.fn();
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });
    const sessionManager = new SessionManager();
    sessionManager.setBridgeFactory(async (_sessionId, _agentId, _cwd, restoreAgentSessionId) => {
      restoreCalls.push(restoreAgentSessionId ?? "");
      return {
        bridge: {
          sendPrompt,
          destroy() {},
        } as any,
        modes: { currentModeId: "code", availableModes: [] },
      };
    });

    app = new Hono();
    app.use("/agents/*", authMiddleware(TOKEN));
    app.use("/sessions/*", authMiddleware(TOKEN));
    app.route("/", createRestRoutes({
      agentManager,
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken: TOKEN,
        snapshotProvider: () => [],
        async onPrompt(sessionId, prompt) {
          const session = store.getSession(sessionId);
          if (!session) {
            connectionManager.broadcastToSession(sessionId, {
              type: "error",
              code: "session_not_found",
              message: "Session not found",
            });
            return;
          }

          if (session.status === "closed") {
            connectionManager.broadcastToSession(sessionId, {
              type: "error",
              code: "session_closed",
              message: "Session is closed",
            });
            return;
          }

          let bridge = sessionManager.getBridge(sessionId);
          if (!bridge && session.status === "suspended" && session.recoverable) {
            bridge = await sessionManager.restoreSession(sessionId, store) ?? undefined;
          }

          if (!bridge) {
            connectionManager.broadcastToSession(sessionId, {
              type: "error",
              code: "session_unavailable",
              message: "Session is unavailable",
            });
            return;
          }

          store.touchSession(sessionId);
          sessionManager.markPromptStarted(sessionId);
          bridge.sendPrompt(sessionId, prompt);
        },
        onCancel: () => {},
        onPermissionResponse: () => {},
      }),
    );

    store.createSession("sess_restore", "test-agent", "/tmp/project", {
      recoverable: true,
      agentSessionId: "agent-existing-session",
    });
    store.updateSessionState("sess_restore", {
      status: "suspended",
      suspendedAt: "2026-03-14T12:00:00.000Z",
    });

    const promptRes = await app.request("/messages", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_restore",
        prompt: [{ type: "text", text: "resume work" }],
      }),
    });

    expect(promptRes.status).toBe(202);
    expect(restoreCalls).toEqual(["agent-existing-session"]);
    expect(sendPrompt).toHaveBeenCalledWith("sess_restore", [{ type: "text", text: "resume work" }]);
    expect(store.getSession("sess_restore")?.status).toBe("active");
    expect(store.getSession("sess_restore")?.suspendedAt).toBeNull();
  });

  it("broadcasts an explicit error when prompting a closed session", async () => {
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });
    const sessionManager = new SessionManager();

    app = new Hono();
    app.use("/agents/*", authMiddleware(TOKEN));
    app.use("/sessions/*", authMiddleware(TOKEN));
    app.route("/", createRestRoutes({
      agentManager,
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken: TOKEN,
        snapshotProvider: () => [],
        async onPrompt(sessionId) {
          const session = store.getSession(sessionId);
          if (session?.status === "closed") {
            connectionManager.broadcastToSession(sessionId, {
              type: "error",
              code: "session_closed",
              message: "Session is closed",
            });
          }
        },
        onCancel: () => {},
        onPermissionResponse: () => {},
      }),
    );

    store.createSession("sess_closed", "test-agent", "/tmp/project");
    store.closeSession("sess_closed");

    const promptRes = await app.request("/messages", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_closed",
        prompt: [{ type: "text", text: "still there?" }],
      }),
    });

    expect(promptRes.status).toBe(202);

    const pollRes = await app.request("/poll?lastEventId=0", {
      headers: authHeaders,
    });
    expect(pollRes.status).toBe(200);
    const events = await pollRes.json();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          code: "session_closed",
          message: "Session is closed",
        }),
      ]),
    );
  });
});
