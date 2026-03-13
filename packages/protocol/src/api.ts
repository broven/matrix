import type { SessionModes, SessionId } from "./session.js";

/** POST /sessions request */
export interface CreateSessionRequest {
  agentId: string;
  cwd: string;
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
  status: "active" | "closed";
}

/** GET /agents response item */
export interface AgentListItem {
  id: string;
  name: string;
  command: string;
  available: boolean;
}

/** GET /sessions/:id/history response item */
export interface HistoryEntry {
  id: string;
  sessionId: SessionId;
  timestamp: string;
  role: "user" | "agent";
  content: string;
}

/** Auth token response */
export interface AuthTokenInfo {
  token: string;
  expiresAt?: string;
}
