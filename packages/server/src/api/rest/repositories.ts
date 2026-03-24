import { Hono } from "hono";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { WorktreeManager } from "../../worktree-manager/index.js";
import type { AddRepositoryRequest, CloneRepositoryRequest, CreateWorktreeRequest, CloneValidationResult } from "@matrix/protocol";
import { normalizeRemoteUrl } from "@matrix/protocol";
import type { CloneManager } from "../../clone-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { getServerConfig } from "./server-config.js";
import { logger } from "../../logger.js";

const log = logger.child({ target: "repositories" });

interface RepositoryRouteDeps {
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  cloneManager: CloneManager;
  connectionManager: ConnectionManager;
}

export function repositoryRoutes(deps: RepositoryRouteDeps) {
  const { store, sessionManager, worktreeManager, cloneManager, connectionManager } = deps;
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

    connectionManager.broadcastToAll({ type: "server:repository_added", repository: repo });
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
          connectionManager.broadcastToAll({ type: "server:session_closed", session: store.getSession(session.sessionId)! });
        }
      }
      // Remove the git worktree
      try {
        await worktreeManager.removeWorktree(repo.path, wt.branch);
      } catch (error) {
        log.error({ branch: wt.branch, err: error }, "failed to remove worktree");
        failedWorktrees.push(wt.branch);
      }
    }

    if (failedWorktrees.length > 0) {
      return c.json({
        error: `Failed to remove worktrees: ${failedWorktrees.join(", ")}. Repository not deleted.`,
      }, 500);
    }

    // Optionally delete source files on disk (before removing DB records)
    const deleteSource = c.req.query("deleteSource") === "true";
    if (deleteSource) {
      const { realpath, rm } = await import("node:fs/promises");

      let resolved: string;
      try {
        resolved = await realpath(repo.path);
      } catch {
        return c.json({ error: `Path does not exist: ${repo.path}` }, 400);
      }

      // Safety: refuse to delete paths that are too shallow (e.g. /, /home, /Users/foo)
      const segments = resolved.split("/").filter(Boolean);
      if (segments.length < 3) {
        return c.json({ error: `Refusing to delete path: ${resolved} (too shallow)` }, 400);
      }

      try {
        await rm(resolved, { recursive: true });
        log.info({ path: resolved }, "deleted source files");
      } catch (error) {
        log.error({ path: resolved, err: error }, "failed to delete source files");
        return c.json({ error: `Failed to delete source files: ${resolved}` }, 500);
      }
    }

    store.deleteRepository(id);
    connectionManager.broadcastToAll({ type: "server:repository_removed", repositoryId: id });
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

    if (!body.branch || !body.baseBranch) {
      return c.json({ error: "branch and baseBranch are required" }, 400);
    }

    // Validate branch name (git check-ref-format rules)
    const invalidBranchPattern = /[\x00-\x1f\x7f ~^:?*\[\\]|\.{2}|@\{|\/\/|\.$|\.lock$|^\/|\/$/;
    if (invalidBranchPattern.test(body.branch) || body.branch.startsWith("-")) {
      return c.json({ error: "Invalid git branch name" }, 400);
    }

    // Check if branch already exists locally
    const refCheck = await $`git -C ${repo.path} show-ref --verify refs/heads/${body.branch}`.quiet().nothrow();
    if (refCheck.exitCode === 0) {
      return c.json({ error: `Branch '${body.branch}' already exists. Please choose a different name.` }, 409);
    }

    // Check if worktree directory would collide with an existing path
    const safeBranch = body.branch.replace(/\//g, "-");
    const candidatePath = path.join(path.dirname(repo.path), `${path.basename(repo.path)}-${safeBranch}`);
    if (fs.existsSync(candidatePath)) {
      return c.json({ error: `Directory for worktree '${body.branch}' already exists. Please choose a different name.` }, 409);
    }

    let worktreePath: string | null = null;
    let worktreeId: string | null = null;
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
      );
      worktreeId = worktree.id;

      // Create session record (no agent spawned yet — lazy init on first prompt)
      const sessionId = `sess_${nanoid()}`;
      store.createSession(sessionId, null, worktreePath, {
        worktreeId: worktree.id,
      });

      const sessionInfo = store.listSessions().find(s => s.sessionId === sessionId);
      if (sessionInfo) {
        connectionManager.broadcastToAll({ type: "server:session_created", session: sessionInfo });
      }

      return c.json({ worktree, sessionId }, 201);
    } catch (error) {
      // Rollback: clean up DB record if it was created
      if (worktreeId) {
        try { store.deleteWorktree(worktreeId); } catch { /* best-effort */ }
      }
      // Rollback: clean up git worktree if it was created
      if (worktreePath) {
        try { await worktreeManager.removeWorktree(repo.path, body.branch); } catch { /* best-effort */ }
      }
      const message = error instanceof Error ? error.message : "Failed to create worktree";
      log.error({ message }, "worktree creation failed");
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

  app.get("/repositories/:repoId/branches", async (c) => {
    const repoId = c.req.param("repoId");
    const repo = store.getRepository(repoId);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }
    try {
      const branches = await worktreeManager.listBranches(repo.path);
      return c.json(branches);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list branches";
      return c.json({ error: message }, 500);
    }
  });

  const ALLOWED_URL = /^(https?:\/\/|git:\/\/|git@)/;

  app.post("/branches/remote", async (c) => {
    const body = await c.req.json<{ url: string }>();
    if (!body.url) {
      return c.json({ error: "url is required" }, 400);
    }
    if (!ALLOWED_URL.test(body.url)) {
      return c.json({ error: "URL must use https://, http://, git://, or git@ protocol" }, 400);
    }
    try {
      const branches = await worktreeManager.listRemoteBranches(body.url);
      return c.json(branches);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list remote branches";
      return c.json({ error: message }, 500);
    }
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
        connectionManager.broadcastToAll({ type: "server:session_closed", session: store.getSession(session.sessionId)! });
      }
    }

    // Remove git worktree — abort if this fails to avoid orphaning
    if (repo) {
      try {
        await worktreeManager.removeWorktree(repo.path, worktree.branch);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git worktree removal failed";
        log.error({ message }, "git removal failed");
        return c.json({ error: message }, 500);
      }
    }

    // Clean up DB records only after successful git removal
    store.deleteWorktree(id);
    return c.json({ ok: true });
  });

  // ── Clone Validation ────────────────────────────────────────────

  app.post("/repositories/clone/validate", async (c) => {
    const body = await c.req.json<CloneRepositoryRequest>();
    const { default: path } = await import("node:path");
    const { existsSync } = await import("node:fs");

    if (!body.url) {
      return c.json({ error: "url is required" }, 400);
    }

    const config = getServerConfig();
    const { CloneManager: CM } = await import("../../clone-manager/index.js");
    const repoName = CM.parseRepoName(body.url);

    // Resolve target directory (same logic as clone endpoint)
    let targetDir: string;
    if (body.targetDir && path.isAbsolute(body.targetDir)) {
      targetDir = path.resolve(body.targetDir);
    } else {
      const dirName = body.targetDir || repoName;
      targetDir = path.resolve(config.reposPath, dirName);
    }

    const warnings: CloneValidationResult["warnings"] = [];
    const conflicts: CloneValidationResult["conflicts"] = [];

    // Rule 1: Check if remote URL already exists in store
    const normalizedInput = normalizeRemoteUrl(body.url);
    const allRepos = store.listRepositories();
    const urlMatch = allRepos.find(
      (r) => r.remoteUrl && normalizeRemoteUrl(r.remoteUrl) === normalizedInput
    );
    if (urlMatch) {
      warnings.push({
        type: "remote_url_exists",
        message: `Repository "${urlMatch.name}" already exists with this remote URL`,
        existingRepository: urlMatch,
      });
    }

    // Rule 2: Check if target directory already exists
    if (existsSync(targetDir)) {
      const isGitRepo = existsSync(path.join(targetDir, ".git"));
      const pathMatch = store.getRepositoryByPath(targetDir);

      conflicts.push({
        type: "directory_exists",
        targetDir,
        isGitRepo,
        alreadyAdded: !!pathMatch,
        existingRepository: pathMatch || undefined,
      });
    }

    return c.json({ warnings, conflicts } satisfies CloneValidationResult);
  });

  // ── Clone ──────────────────────────────────────────────────────

  app.post("/repositories/clone", async (c) => {
    const body = await c.req.json<CloneRepositoryRequest>();
    const { default: path } = await import("node:path");

    if (!body.url) {
      return c.json({ error: "url is required" }, 400);
    }

    // Validate URL protocol scheme
    const allowedSchemes = /^(https?:\/\/|git:\/\/|git@)/;
    if (!allowedSchemes.test(body.url)) {
      return c.json({ error: "URL must use https://, http://, git://, or git@ protocol" }, 400);
    }

    // Validate branch name if provided
    if (body.branch) {
      const safeBranch = /^[a-zA-Z0-9._\-/]+$/;
      if (!safeBranch.test(body.branch)) {
        return c.json({ error: "Invalid branch name" }, 400);
      }
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
        if (job.status !== "failed") {
          // Auto-register the cloned repo (awaited so status reflects registration)
          // Note: onComplete is called BEFORE status is set to "completed" on success path
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
              connectionManager.broadcastToAll({ type: "server:repository_added", repository: repo });
            }
          } catch (err) {
            log.error({ err }, "failed to auto-register repository");
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
