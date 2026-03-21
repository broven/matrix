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

// ── Clone Validation ─────────────────────────────────────────────

/** POST /repositories/clone/validate request — reuses CloneRepositoryRequest */

/** Clone validation warning (soft — user can proceed) */
export interface CloneWarning {
  type: "remote_url_exists";
  message: string;
  existingRepository: RepositoryInfo;
}

/** Clone validation conflict (hard — cannot proceed with clone) */
export interface CloneConflict {
  type: "directory_exists";
  targetDir: string;
  isGitRepo: boolean;
  alreadyAdded: boolean;
  existingRepository?: RepositoryInfo;
}

/** POST /repositories/clone/validate response */
export interface CloneValidationResult {
  warnings: CloneWarning[];
  conflicts: CloneConflict[];
}

// ── Utilities ────────────────────────────────────────────────────

/**
 * Normalize a git remote URL for comparison.
 * Strips trailing .git, trailing slashes, and lowercases the host.
 * Converts SSH URLs (git@host:user/repo) to a canonical form.
 */
export function normalizeRemoteUrl(url: string): string {
  let normalized = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  // Convert SSH git@host:user/repo → host/user/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    normalized = `${sshMatch[1].toLowerCase()}/${sshMatch[2]}`;
  } else {
    try {
      const parsed = new URL(normalized);
      normalized = `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    } catch {
      // Not a valid URL, use as-is for comparison
    }
  }
  return normalized;
}

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
