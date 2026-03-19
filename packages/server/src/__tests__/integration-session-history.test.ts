import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { authMiddleware } from "../auth/middleware.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-integration-history.db";
const TOKEN = "history-test-token";

describe("Integration: session history persistence", () => {
  let app: Hono;
  let store: Store;

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
    store.normalizeSessionsOnStartup();
    app = new Hono();
    app.use("/sessions/*", authMiddleware(TOKEN));
    const sessionManager = new SessionManager();
    app.route("/", createRestRoutes({
      agentManager,
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));
  });

  afterEach(() => {
    store.close();
    for (const ext of ["", "-wal", "-shm"]) {
      try { unlinkSync(DB_PATH + ext); } catch {}
    }
  });

  const authHeaders = { Authorization: `Bearer ${TOKEN}` };

  it("persists and retrieves multi-turn conversation history", async () => {
    store.createSession("sess_hist", "test-agent", "/tmp/project");

    // Simulate a multi-turn conversation
    store.appendHistory("sess_hist", "user", "What is 2+2?");
    store.appendHistory("sess_hist", "agent", "2+2 = 4");
    store.appendHistory("sess_hist", "user", "And 3+3?");
    store.appendHistory("sess_hist", "agent", "3+3 = 6");

    const res = await app.request("/sessions/sess_hist/history", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const history = await res.json();
    expect(history).toHaveLength(4);

    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("What is 2+2?");
    expect(history[1].role).toBe("agent");
    expect(history[1].content).toBe("2+2 = 4");
    expect(history[2].role).toBe("user");
    expect(history[2].content).toBe("And 3+3?");
    expect(history[3].role).toBe("agent");
    expect(history[3].content).toBe("3+3 = 6");

    // Each entry should have required fields
    for (const entry of history) {
      expect(entry.id).toBeDefined();
      expect(entry.sessionId).toBe("sess_hist");
      expect(entry.timestamp).toBeDefined();
    }
  });

  it("returns 404 for non-existent session history", async () => {
    const res = await app.request("/sessions/nonexistent/history", {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("returns empty history for session with no messages", async () => {
    store.createSession("sess_empty", "test-agent", "/tmp");
    const res = await app.request("/sessions/sess_empty/history", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const history = await res.json();
    expect(history).toEqual([]);
  });

  it("history persists after session is closed", async () => {
    store.createSession("sess_close", "test-agent", "/tmp");
    store.appendHistory("sess_close", "user", "before close");
    store.appendHistory("sess_close", "agent", "response before close");

    // Close the session
    store.closeSession("sess_close");

    // History should still be accessible
    const res = await app.request("/sessions/sess_close/history", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const history = await res.json();
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("before close");
  });

  it("multiple sessions have independent histories", async () => {
    store.createSession("sess_a", "test-agent", "/tmp/a");
    store.createSession("sess_b", "test-agent", "/tmp/b");

    store.appendHistory("sess_a", "user", "message for A");
    store.appendHistory("sess_b", "user", "message for B");
    store.appendHistory("sess_b", "agent", "reply in B");

    const resA = await app.request("/sessions/sess_a/history", {
      headers: authHeaders,
    });
    const historyA = await resA.json();
    expect(historyA).toHaveLength(1);
    expect(historyA[0].content).toBe("message for A");

    const resB = await app.request("/sessions/sess_b/history", {
      headers: authHeaders,
    });
    const historyB = await resB.json();
    expect(historyB).toHaveLength(2);
    expect(historyB[1].content).toBe("reply in B");
  });

  it("startup normalization preserves history while changing recoverable session states", async () => {
    store.close();

    const preRestartStore = new Store(DB_PATH);
    preRestartStore.createSession("sess_recoverable", "test-agent", "/tmp/recoverable", {
      recoverable: true,
      agentSessionId: "agent_recoverable",
    });
    preRestartStore.createSession("sess_unrecoverable", "test-agent", "/tmp/unrecoverable");
    preRestartStore.appendHistory("sess_recoverable", "user", "persist me");
    preRestartStore.appendHistory("sess_unrecoverable", "agent", "still here");
    preRestartStore.close();

    store = new Store(DB_PATH);
    store.normalizeSessionsOnStartup();

    const sessionManager = new SessionManager();
    app = new Hono();
    app.use("/sessions/*", authMiddleware(TOKEN));
    app.route("/", createRestRoutes({
      agentManager: new AgentManager(),
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));

    expect(store.getSession("sess_recoverable")?.status).toBe("active");
    expect(store.getSession("sess_unrecoverable")?.status).toBe("closed");
    expect(store.getSession("sess_unrecoverable")?.closeReason).toBe("server_restart_unrecoverable");

    const recoverableHistoryRes = await app.request("/sessions/sess_recoverable/history", {
      headers: authHeaders,
    });
    expect(recoverableHistoryRes.status).toBe(200);
    const recoverableHistory = await recoverableHistoryRes.json();
    expect(recoverableHistory).toHaveLength(1);
    expect(recoverableHistory[0].content).toBe("persist me");

    const unrecoverableHistoryRes = await app.request("/sessions/sess_unrecoverable/history", {
      headers: authHeaders,
    });
    expect(unrecoverableHistoryRes.status).toBe(200);
    const unrecoverableHistory = await unrecoverableHistoryRes.json();
    expect(unrecoverableHistory).toHaveLength(1);
    expect(unrecoverableHistory[0].content).toBe("still here");
  });
});
