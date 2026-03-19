import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { WorktreeManager } from "../../worktree-manager/index.js";
import type { AddRepositoryRequest, CloneRepositoryRequest, CreateWorktreeRequest } from "@matrix/protocol";
import type { CloneManager } from "../../clone-manager/index.js";
import { getServerConfig } from "./server-config.js";

interface RepositoryRouteDeps {
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  cloneManager: CloneManager;
  createSessionForWorktree: (
    agentId: string,
    cwd: string,
    worktreeId: string,
  ) => Promise<{ sessionId: string; modes: { currentModeId: string; availableModes: unknown[] } }>;
}

export function repositoryRoutes(deps: RepositoryRouteDeps) {
  const { store, sessionManager, worktreeManager, cloneManager, createSessionForWorktree } = deps;
  const app = new Hono();

  // ── Repositories ────────────────────────────────────────────────

  app.post("/repositories", async (c) => {
    const body = await c.req.json<AddRepositoryRequest>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
    }

    // Return existing repository if path already added
    const existing = store.listRepositories().find(
      (r) => r.path === body.path,
    );
    if (existing) {
      return c.json(existing, 200);
    }

    // Validate it's a git repo
    const isGitRepo = await worktreeManager.validateGitRepo(body.path);
    if (!isGitRepo) {
      return c.json({ error: "Not a valid git repository" }, 400);
    }

    // Detect default branch
    const defaultBranch = await worktreeManager.detectDefaultBranch(body.path);

    // Use provided name or derive from path
    const name = body.name || body.path.split("/").pop() || "repo";

    const repo = store.createRepository(name, body.path, {
      remoteUrl: body.remoteUrl,
      defaultBranch,
    });

    return c.json(repo, 201);
  });

  app.get("/repositories", (c) => {
    return c.json(store.listRepositories());
  });

  app.delete("/repositories/:id", async (c) => {
    const id = c.req.param("id");
    const repo = store.getRepository(id);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }

    // Close live sessions and remove git worktrees before deleting DB records
    const repoWorktrees = store.listWorktrees(id);
    const failedWorktrees: string[] = [];

    for (const wt of repoWorktrees) {
      // Close any live sessions tied to this worktree
      const wtSessions = store.getSessionsByWorktree(wt.id);
      for (const session of wtSessions) {
        if (session.status !== "closed") {
          sessionManager.closeSession(session.sessionId, store);
        }
      }
      // Remove the git worktree
      try {
        await worktreeManager.removeWorktree(repo.path, wt.branch);
      } catch (error) {
        console.error(`[repo] Failed to remove worktree ${wt.branch}:`, error);
        failedWorktrees.push(wt.branch);
      }
    }

    if (failedWorktrees.length > 0) {
      return c.json({
        error: `Failed to remove worktrees: ${failedWorktrees.join(", ")}. Repository not deleted.`,
      }, 500);
    }

    store.deleteRepository(id);
    return c.json({ ok: true });
  });

  // ── Worktrees ───────────────────────────────────────────────────

  app.post("/repositories/:repoId/worktrees", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = store.getRepository(repoId);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }

    const body = await c.req.json<CreateWorktreeRequest>();

    if (!body.branch || !body.baseBranch || !body.agentId) {
      return c.json({ error: "branch, baseBranch, and agentId are required" }, 400);
    }

    // Validate branch name (git check-ref-format rules)
    const invalidBranchPattern = /[\x00-\x1f\x7f ~^:?*\[\\]|\.{2}|@\{|\/\/|\.$|\.lock$|^\/|\/$/;
    if (invalidBranchPattern.test(body.branch) || body.branch.startsWith("-")) {
      return c.json({ error: "Invalid git branch name" }, 400);
    }

    let worktreePath: string | null = null;
    let worktreeId: string | null = null;
    let sessionId: string | null = null;
    try {
      // Create the git worktree
      worktreePath = await worktreeManager.createWorktree(
        repo.path,
        body.branch,
        body.baseBranch,
      );

      // Store worktree record
      const worktree = store.createWorktree(
        repoId,
        body.branch,
        body.baseBranch,
        worktreePath,
        body.taskDescription,
      );
      worktreeId = worktree.id;

      // Create agent session in the new worktree
      const session = await createSessionForWorktree(
        body.agentId,
        worktreePath,
        worktree.id,
      );
      sessionId = session.sessionId;

      return c.json({ worktree, session }, 201);
    } catch (error) {
      // Rollback: tear down session if it was registered
      if (sessionId) {
        try { sessionManager.closeSession(sessionId, store); } catch { /* best-effort */ }
      }
      // Rollback: clean up DB record if it was created
      if (worktreeId) {
        try { store.deleteWorktree(worktreeId); } catch { /* best-effort */ }
      }
      // Rollback: clean up git worktree if it was created
      if (worktreePath) {
        try { await worktreeManager.removeWorktree(repo.path, body.branch); } catch { /* best-effort */ }
      }
      const message = error instanceof Error ? error.message : "Failed to create worktree";
      console.error(`[worktree] Creation failed:`, message);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/repositories/:repoId/worktrees", (c) => {
    const repoId = c.req.param("repoId");
    const repo = store.getRepository(repoId);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }
    return c.json(store.listWorktrees(repoId));
  });

  app.delete("/worktrees/:id", async (c) => {
    const id = c.req.param("id");
    const worktree = store.getWorktree(id);
    if (!worktree) {
      return c.json({ error: "Worktree not found" }, 404);
    }

    const repo = store.getRepository(worktree.repositoryId);

    // Close live sessions tied to this worktree
    const wtSessions = store.getSessionsByWorktree(id);
    for (const session of wtSessions) {
      if (session.status !== "closed") {
        sessionManager.closeSession(session.sessionId, store);
      }
    }

    // Remove git worktree — abort if this fails to avoid orphaning
    if (repo) {
      try {
        await worktreeManager.removeWorktree(repo.path, worktree.branch);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git worktree removal failed";
        console.error(`[worktree] Git removal failed:`, message);
        return c.json({ error: message }, 500);
      }
    }

    // Clean up DB records only after successful git removal
    store.deleteWorktree(id);
    return c.json({ ok: true });
  });

  // ── Clone ──────────────────────────────────────────────────────

  app.post("/repositories/clone", async (c) => {
    const body = await c.req.json<CloneRepositoryRequest>();
    const { default: path } = await import("node:path");

    if (!body.url) {
      return c.json({ error: "url is required" }, 400);
    }

    const config = getServerConfig();
    const repoName = (await import("../../clone-manager/index.js")).CloneManager.parseRepoName(body.url);

    // Determine target directory — always resolve relative to reposPath
    let targetDir: string;
    if (body.targetDir && path.isAbsolute(body.targetDir)) {
      targetDir = path.resolve(body.targetDir);
    } else {
      // Use provided name or parsed repo name, always under reposPath
      const dirName = body.targetDir || repoName;
      targetDir = path.resolve(config.reposPath, dirName);
    }

    // Path containment check: absolute paths must be under reposPath
    const resolvedReposPath = path.resolve(config.reposPath);
    if (!targetDir.startsWith(resolvedReposPath + path.sep) && targetDir !== resolvedReposPath) {
      return c.json({ error: "Target directory must be within the configured repos path" }, 400);
    }

    const jobId = cloneManager.startClone(
      body.url,
      targetDir,
      body.branch,
      async (job) => {
        if (job.status === "completed") {
          // Auto-register the cloned repo (awaited so status reflects registration)
          try {
            const isValid = await worktreeManager.validateGitRepo(job.targetDir);
            if (isValid) {
              const defaultBranch = await worktreeManager.detectDefaultBranch(job.targetDir);
              const name = path.basename(job.targetDir);
              const repo = store.createRepository(name, job.targetDir, {
                remoteUrl: job.url,
                defaultBranch,
              });
              job.repositoryId = repo.id;
            }
          } catch (err) {
            console.error("[clone] Failed to auto-register repository:", err);
          }
        }
      },
    );

    return c.json({ jobId }, 202);
  });

  app.get("/repositories/clone/:jobId", (c) => {
    const jobId = c.req.param("jobId");
    const job = cloneManager.getJob(jobId);
    if (!job) {
      return c.json({ error: "Clone job not found" }, 404);
    }
    return c.json(job);
  });

  app.get("/repositories/clone-jobs", (c) => {
    return c.json(cloneManager.listJobs());
  });

  return app;
}
