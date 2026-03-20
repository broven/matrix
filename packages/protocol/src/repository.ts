/** Repository identifier */
export type RepositoryId = string;

/** Worktree identifier */
export type WorktreeId = string;

/** Worktree status */
export type WorktreeStatus = "active" | "closed";

/** GET /repositories response item */
export interface RepositoryInfo {
  id: RepositoryId;
  name: string;
  path: string;
  remoteUrl: string | null;
  serverId: string;
  defaultBranch: string;
  createdAt: string;
}

/** POST /repositories request */
export interface AddRepositoryRequest {
  path: string;
  name?: string;
  remoteUrl?: string;
}

/** Worktree info returned from API */
export interface WorktreeInfo {
  id: WorktreeId;
  repositoryId: RepositoryId;
  branch: string;
  baseBranch: string;
  path: string;
  status: WorktreeStatus;
  taskDescription: string | null;
  createdAt: string;
  lastActiveAt: string;
}

/** POST /repositories/:repoId/worktrees request */
export interface CreateWorktreeRequest {
  branch: string;
  baseBranch: string;
}

/** POST /repositories/:repoId/worktrees response */
export interface CreateWorktreeResponse {
  worktree: WorktreeInfo;
  sessionId: string;
}

// ── Filesystem ────────────────────────────────────────────────────

/** Single entry returned by the filesystem listing API */
export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isGitRepo: boolean;
}

/** GET /fs/list response */
export interface FsListResponse {
  entries: FsEntry[];
}

// ── Clone ─────────────────────────────────────────────────────────

/** POST /repositories/clone request */
export interface CloneRepositoryRequest {
  url: string;
  targetDir?: string;
  branch?: string;
}

/** POST /repositories/clone response */
export interface CloneRepositoryResponse {
  jobId: string;
}

/** Clone job status */
export type CloneJobStatus = "cloning" | "completed" | "failed";

/** GET /repositories/clone/:jobId response */
export interface CloneJobInfo {
  jobId: string;
  status: CloneJobStatus;
  url: string;
  targetDir: string;
  repositoryId?: string;
  error?: string;
}

// ── Utilities ────────────────────────────────────────────────────

/**
 * Parse a repository name from a git URL.
 * Handles SSH (git@github.com:user/repo.git) and HTTPS URLs.
 */
export function parseRepoName(url: string): string {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = cleaned.split(/[/:]/);
  const name = parts[parts.length - 1] || "repo";
  // Sanitize: strip path-traversal sequences and invalid chars
  const safe = name.replace(/\.\./g, "").replace(/[/\\]/g, "");
  return safe || "repo";
}

// ── Server Config ─────────────────────────────────────────────────

/** Per-server path configuration */
export interface ServerConfig {
  reposPath: string;
  worktreesPath: string;
  defaultAgent?: string;
}
