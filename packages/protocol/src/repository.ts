/** Repository identifier */
export type RepositoryId = string;

/** Worktree identifier */
export type WorktreeId = string;

/** Worktree status */
export type WorktreeStatus = "active" | "suspended" | "closed";

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
  agentId: string;
  taskDescription?: string;
}

/** POST /repositories/:repoId/worktrees response */
export interface CreateWorktreeResponse {
  worktree: WorktreeInfo;
  session: {
    sessionId: string;
    modes: { currentModeId: string; availableModes: unknown[] };
  };
}
