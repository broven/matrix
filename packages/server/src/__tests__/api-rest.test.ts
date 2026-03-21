import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-rest-test.db";

describe("REST API", () => {
  let app: Hono;
  let store: Store;
  let sessionManager: SessionManager;

  beforeEach(() => {
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });
    store = new Store(DB_PATH);
    sessionManager = new SessionManager();
    const connectionManager = new ConnectionManager();
    app = new Hono();
    app.route("/", createRestRoutes({
      agentManager,
      store,
      sessionManager,
      worktreeManager: new WorktreeManager(),
      connectionManager,
      createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
    }));
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
  });

  it("GET /agents returns registered agents", async () => {
    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("test-agent");
  });

  it("GET /sessions returns empty list initially", async () => {
    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /sessions/:id/history returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/unknown/history");
    expect(res.status).toBe(404);
  });
});
