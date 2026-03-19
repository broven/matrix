import type { SessionModes, SessionId } from "./session.js";
import type { RepositoryId, WorktreeId } from "./repository.js";

/** POST /sessions request */
export interface CreateSessionRequest {
  agentId: string;
  /** @deprecated Use worktreeId instead for new sessions */
  cwd?: string;
  worktreeId?: WorktreeId;
}

/** POST /sessions response */
export interface CreateSessionResponse {
  sessionId: SessionId;
  modes: SessionModes;
}

/** GET /sessions response item */
export interface SessionInfo {
  sessionId: SessionId;
  agentId: string;
  cwd: string;
  createdAt: string;
  status: "active" | "suspended" | "restoring" | "closed";
  recoverable: boolean;
  agentSessionId: string | null;
  lastActiveAt: string;
  suspendedAt: string | null;
  closeReason: string | null;
  worktreeId: string | null;
  repositoryId: string | null;
  branch: string | null;
}

/** GET /agents response item */
export interface AgentListItem {
  id: string;
  name: string;
  command: string;
  available: boolean;
  icon?: string;
  description?: string;
}

/** History entry type discriminator */
export type HistoryEntryType =
  | "text"
  | "tool_call"
  | "tool_call_update"
  | "permission_request"
  | "plan"
  | "completed";

/** GET /sessions/:id/history response item */
export interface HistoryEntry {
  id: string;
  sessionId: SessionId;
  timestamp: string;
  role: "user" | "agent";
  content: string;
  type: HistoryEntryType;
  metadata?: Record<string, unknown> | null;
}

/** Auth token response */
export interface AuthTokenInfo {
  token: string;
  expiresAt?: string;
}
