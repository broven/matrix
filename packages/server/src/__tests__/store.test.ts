import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../store/index.js";
import { unlinkSync } from "node:fs";
import { Database } from "bun:sqlite";

const DB_PATH = "/tmp/matrix-test.db";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
    store = new Store(DB_PATH);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
  });

  it("creates a session", () => {
    const session = store.createSession("sess_1", "echo-agent", "/tmp/project");
    expect(session.sessionId).toBe("sess_1");
    expect(session.status).toBe("active");
    expect(session.recoverable).toBe(false);
    expect(session.agentSessionId).toBeNull();
    expect(session.lastActiveAt).toBeDefined();
    expect(session.suspendedAt).toBeNull();
    expect(session.closeReason).toBeNull();
  });

  it("lists active sessions", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.createSession("sess_2", "echo-agent", "/tmp/b");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("closes a session", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.closeSession("sess_1");
    const sessions = store.listSessions();
    expect(sessions[0].status).toBe("closed");
    expect(sessions[0].closeReason).toBe("user_closed");
  });

  it("gets a session with lifecycle metadata", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a", {
      recoverable: true,
      agentSessionId: "agent_sess_1",
    });

    const session = store.getSession("sess_1");
    expect(session).not.toBeNull();
    expect(session?.recoverable).toBe(true);
    expect(session?.agentSessionId).toBe("agent_sess_1");
    expect(session?.status).toBe("active");
    expect(session?.lastActiveAt).toBeDefined();
    expect(session?.suspendedAt).toBeNull();
    expect(session?.closeReason).toBeNull();
  });

  it("updates session state with a partial patch", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a", {
      recoverable: true,
      agentSessionId: "agent_sess_1",
    });

    store.updateSessionState("sess_1", {
      status: "active",
      suspendedAt: "2026-03-14T12:00:00.000Z",
      closeReason: "idle_timeout",
    });

    const session = store.getSession("sess_1");
    expect(session?.status).toBe("active");
    expect(session?.suspendedAt).toBe("2026-03-14T12:00:00.000Z");
    expect(session?.closeReason).toBe("idle_timeout");
    expect(session?.recoverable).toBe(true);
  });

  it("touches a session activity timestamp", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");

    store.touchSession("sess_1", "2026-03-14T13:00:00.000Z");

    const session = store.getSession("sess_1");
    expect(session?.lastActiveAt).toBe("2026-03-14T13:00:00.000Z");
  });

  it("normalizes lifecycle state on startup", () => {
    store.createSession("sess_recoverable", "echo-agent", "/tmp/a", {
      recoverable: true,
      agentSessionId: "agent_recoverable",
    });
    store.createSession("sess_unrecoverable", "echo-agent", "/tmp/b");

    store.normalizeSessionsOnStartup();

    expect(store.getSession("sess_recoverable")?.status).toBe("active");
    expect(store.getSession("sess_recoverable")?.closeReason).toBeNull();
    expect(store.getSession("sess_unrecoverable")?.status).toBe("closed");
    expect(store.getSession("sess_unrecoverable")?.closeReason).toBe("server_restart_unrecoverable");
  });

  it("migrates older session tables without failing on lifecycle columns", () => {
    store.close();

    const legacyDb = new Database(DB_PATH);
    legacyDb.exec(`
      DROP TABLE IF EXISTS history;
      DROP TABLE IF EXISTS sessions;
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );
      INSERT INTO sessions (session_id, agent_id, cwd, status, created_at)
      VALUES ('sess_legacy', 'echo-agent', '/tmp/legacy', 'active', '2026-03-14 13:46:26');
    `);
    legacyDb.close();

    store = new Store(DB_PATH);

    const session = store.getSession("sess_legacy");
    expect(session).not.toBeNull();
    expect(session?.status).toBe("active");
    expect(session?.recoverable).toBe(false);
    expect(session?.agentSessionId).toBeNull();
    expect(session?.lastActiveAt).toBe("2026-03-14 13:46:26");
  });

  it("appends and retrieves history", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "user", "hello");
    store.appendHistory("sess_1", "agent", "hi there");
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].content).toBe("hi there");
  });

  it("stores default type as 'text' for plain history entries", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "user", "hello");
    const history = store.getHistory("sess_1");
    expect(history[0].type).toBe("text");
    expect(history[0].metadata).toBeNull();
  });

  it("stores history with explicit type and metadata", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "agent", "", "tool_call", {
      toolCallId: "tc_1",
      title: "read file",
      kind: "read",
      status: "running",
    });
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("tool_call");
    expect(history[0].metadata).toEqual({
      toolCallId: "tc_1",
      title: "read file",
      kind: "read",
      status: "running",
    });
  });

  it("appendEvent stores structured event data", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendEvent("sess_1", "tool_call", {
      sessionUpdate: "tool_call",
      toolCallId: "tc_1",
      title: "edit file",
      kind: "edit",
      status: "pending",
    });
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("tool_call");
    expect(history[0].role).toBe("agent");
    expect(history[0].metadata!.toolCallId).toBe("tc_1");
    expect(history[0].metadata!.title).toBe("edit file");
  });

  it("appendEvent stores plan events", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendEvent("sess_1", "plan", {
      sessionUpdate: "plan",
      entries: [
        { content: "Step 1", priority: "high", status: "pending" },
      ],
    });
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("plan");
    expect(history[0].metadata!.entries).toEqual([
      { content: "Step 1", priority: "high", status: "pending" },
    ]);
  });

  it("appendEvent stores permission_request events", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendEvent("sess_1", "permission_request", {
      sessionUpdate: "permission_request",
      toolCallId: "tc_1",
      toolCall: { toolCallId: "tc_1", title: "rm -rf", kind: "execute", status: "pending" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("permission_request");
    expect(history[0].metadata!.toolCallId).toBe("tc_1");
  });

  it("appendEvent stores completed events", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendEvent("sess_1", "completed", {
      sessionUpdate: "completed",
      stopReason: "end_turn",
    });
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("completed");
    expect(history[0].metadata!.stopReason).toBe("end_turn");
  });

  it("backward compat: appendHistory works with only 3 args", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "user", "hello");
    const history = store.getHistory("sess_1");
    expect(history[0].type).toBe("text");
    expect(history[0].metadata).toBeNull();
  });

  it("handles null metadata correctly", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "agent", "text", "text", null);
    const history = store.getHistory("sess_1");
    expect(history[0].metadata).toBeNull();
  });

  it("preserves ordering with mixed event types", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "user", "do something");
    store.appendEvent("sess_1", "tool_call", { toolCallId: "tc_1", title: "read", kind: "read", status: "running" });
    store.appendHistory("sess_1", "agent", "Here is the result", "text");
    store.appendEvent("sess_1", "completed", { sessionUpdate: "completed", stopReason: "end_turn" });

    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(4);
    expect(history[0].type).toBe("text");
    expect(history[0].role).toBe("user");
    expect(history[1].type).toBe("tool_call");
    expect(history[2].type).toBe("text");
    expect(history[2].role).toBe("agent");
    expect(history[3].type).toBe("completed");
  });
});
