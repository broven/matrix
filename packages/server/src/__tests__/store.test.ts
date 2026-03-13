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
});
