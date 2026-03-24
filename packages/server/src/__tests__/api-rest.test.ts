import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";
import { CloneManager } from "../clone-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync, mkdirSync, rmSync } from "node:fs";
import { $ } from "bun";

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

  // ── Worktree Creation Validation ────────────────────────────────

  describe("POST /repositories/:repoId/worktrees validation", () => {
    const REPO_PATH = "/tmp/matrix-test-repo-worktree";

    function buildAppWithWorktreeManager(wm: Partial<WorktreeManager>) {
      const agentManager = new AgentManager();
      agentManager.register({ id: "test-agent", name: "Test Agent", command: "echo", args: [] });
      const s = new Store(DB_PATH);
      const sm = new SessionManager();
      const cm = new ConnectionManager();
      const a = new Hono();
      a.route("/", createRestRoutes({
        agentManager,
        store: s,
        sessionManager: sm,
        worktreeManager: wm as WorktreeManager,
        cloneManager: new CloneManager(),
        connectionManager: cm,
        createSessionForWorktree: async () => ({ sessionId: "sess_wt_test", modes: { currentModeId: "code", availableModes: [] } }),
      }));
      return { app: a, store: s };
    }

    beforeEach(async () => {
      // Create a real git repo so git show-ref commands work
      rmSync(REPO_PATH, { recursive: true, force: true });
      mkdirSync(REPO_PATH, { recursive: true });
      await $`git init ${REPO_PATH}`.quiet();
      await $`git -C ${REPO_PATH} -c user.email="test@test.com" -c user.name="Test" commit --allow-empty -m "init"`.quiet();
    });

    afterEach(() => {
      rmSync(REPO_PATH, { recursive: true, force: true });
    });

    it("returns 404 when repository does not exist", async () => {
      const { app: a, store: s } = buildAppWithWorktreeManager({});
      try {
        const res = await a.request("/repositories/nonexistent/worktrees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: "new-branch", baseBranch: "main" }),
        });
        expect(res.status).toBe(404);
      } finally {
        s.close();
      }
    });

    it("returns 400 when branch name is missing", async () => {
      const { app: a, store: s } = buildAppWithWorktreeManager({});
      try {
        const repo = s.createRepository("test-repo", REPO_PATH, {});
        const res = await a.request(`/repositories/${repo.id}/worktrees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseBranch: "main" }),
        });
        expect(res.status).toBe(400);
      } finally {
        s.close();
      }
    });

    it("returns 400 when branch name is invalid", async () => {
      const { app: a, store: s } = buildAppWithWorktreeManager({});
      try {
        const repo = s.createRepository("test-repo", REPO_PATH, {});
        const res = await a.request(`/repositories/${repo.id}/worktrees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: "bad..name", baseBranch: "main" }),
        });
        expect(res.status).toBe(400);
      } finally {
        s.close();
      }
    });

    it("returns 409 when branch already exists locally", async () => {
      // Create the branch in the real git repo
      await $`git -C ${REPO_PATH} checkout -b existing-branch`.quiet();
      await $`git -C ${REPO_PATH} checkout -`.quiet();

      const { app: a, store: s } = buildAppWithWorktreeManager({});
      try {
        const repo = s.createRepository("test-repo", REPO_PATH, {});
        const res = await a.request(`/repositories/${repo.id}/worktrees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: "existing-branch", baseBranch: "main" }),
        });
        expect(res.status).toBe(409);
        const body = await res.json() as { error: string };
        expect(body.error).toContain("existing-branch");
        expect(body.error).toContain("already exists");
      } finally {
        s.close();
      }
    });

    it("returns 409 when worktree directory already exists on disk", async () => {
      const candidatePath = "/tmp/matrix-test-repo-worktree-my-feature";
      mkdirSync(candidatePath, { recursive: true });
      try {
        const { app: a, store: s } = buildAppWithWorktreeManager({});
        try {
          const repo = s.createRepository("test-repo", REPO_PATH, {});
          const res = await a.request(`/repositories/${repo.id}/worktrees`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branch: "my-feature", baseBranch: "main" }),
          });
          expect(res.status).toBe(409);
          const body = await res.json() as { error: string };
          expect(body.error).toContain("my-feature");
          expect(body.error).toContain("already exists");
        } finally {
          s.close();
        }
      } finally {
        rmSync(candidatePath, { recursive: true, force: true });
      }
    });

    it("returns 201 when branch and directory are both free", async () => {
      const mockWm = {
        createWorktree: vi.fn().mockResolvedValue("/tmp/matrix-test-repo-worktree-fresh"),
        listWorktrees: vi.fn().mockResolvedValue([]),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
      };
      const { app: a, store: s } = buildAppWithWorktreeManager(mockWm);
      try {
        const repo = s.createRepository("test-repo", REPO_PATH, {});
        const res = await a.request(`/repositories/${repo.id}/worktrees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: "fresh-branch", baseBranch: "main" }),
        });
        expect(res.status).toBe(201);
        expect(mockWm.createWorktree).toHaveBeenCalledWith(REPO_PATH, "fresh-branch", "main");
      } finally {
        s.close();
      }
    });
  });
});
