import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { WorktreeManager } from "../../worktree-manager/index.js";
import type { AddRepositoryRequest, CreateWorktreeRequest } from "@matrix/protocol";

interface RepositoryRouteDeps {
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  createSessionForWorktree: (
    agentId: string,
    cwd: string,
    worktreeId: string,
  ) => Promise<{ sessionId: string; modes: { currentModeId: string; availableModes: unknown[] } }>;
}

export function repositoryRoutes(deps: RepositoryRouteDeps) {
  const { store, sessionManager, worktreeManager, createSessionForWorktree } = deps;
  const app = new Hono();

  // ── Repositories ────────────────────────────────────────────────

  app.post("/repositories", async (c) => {
    const body = await c.req.json<AddRepositoryRequest>();

    if (!body.path) {
      return c.json({ error: "path is required" }, 400);
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

  return app;
}
