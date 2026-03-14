import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { createTransportRoutes } from "../api/transport/index.js";
import { authMiddleware } from "../auth/middleware.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync } from "node:fs";

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
    app.route("/", createRestRoutes(agentManager, store, sessionManager));
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

    // 8. Verify session is closed
    const finalListRes = await app.request("/sessions", { headers: authHeaders });
    const finalSessions = await finalListRes.json();
    expect(finalSessions[0].status).toBe("closed");
  });
});
