import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../store/index.js";
import { unlinkSync } from "node:fs";

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
