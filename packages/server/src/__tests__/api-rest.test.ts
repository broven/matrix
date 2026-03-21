import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";
import { CloneManager } from "../clone-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync, mkdirSync, rmSync } from "node:fs";

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
      cloneManager: new CloneManager(),
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

  // ── Clone Validation ────────────────────────────────────────────

  describe("POST /repositories/clone/validate", () => {
    it("returns empty warnings and conflicts for fresh clone", async () => {
      const res = await app.request("/repositories/clone/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/test/new-repo.git" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.warnings).toEqual([]);
      expect(body.conflicts).toEqual([]);
    });

    it("returns warning when remote URL already exists", async () => {
      store.createRepository("existing", "/tmp/existing", {
        remoteUrl: "https://github.com/test/existing.git",
      });

      const res = await app.request("/repositories/clone/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/test/existing.git" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0].type).toBe("remote_url_exists");
      expect(body.warnings[0].existingRepository.name).toBe("existing");
    });

    it("normalizes URLs for comparison (with/without .git suffix)", async () => {
      store.createRepository("repo", "/tmp/repo", {
        remoteUrl: "https://github.com/test/repo.git",
      });

      const res = await app.request("/repositories/clone/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/test/repo" }),
      });
      const body = await res.json();
      expect(body.warnings).toHaveLength(1);
      expect(body.warnings[0].type).toBe("remote_url_exists");
    });

    it("returns conflict when target directory exists", async () => {
      const testDir = "/tmp/matrix-test-clone-validate";
      mkdirSync(testDir, { recursive: true });

      try {
        const res = await app.request("/repositories/clone/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://github.com/test/matrix-test-clone-validate.git", targetDir: testDir }),
        });
        const body = await res.json();
        expect(body.conflicts).toHaveLength(1);
        expect(body.conflicts[0].type).toBe("directory_exists");
        expect(body.conflicts[0].isGitRepo).toBe(false);
        expect(body.conflicts[0].alreadyAdded).toBe(false);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("returns 400 when url is missing", async () => {
      const res = await app.request("/repositories/clone/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
