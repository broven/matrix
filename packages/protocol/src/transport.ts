import type { SessionUpdate, SessionModes, PermissionOutcome } from "./session.js";
import type { HistoryEntry, SessionInfo, AgentListItem } from "./api.js";
import type { RepositoryInfo } from "./repository.js";

/** Transport mode for client-server communication */
export type TransportMode = "websocket" | "sse" | "polling" | "auto";

/** Connection status */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "offline";

/** WebSocket message envelope from server to client */
export type ServerMessage =
  | { type: "session:update"; sessionId: string; update: SessionUpdate; eventId: string }
  | { type: "session:snapshot"; sessionId: string; history: HistoryEntry[]; eventId: string }
  | { type: "session:suspended"; sessionId: string; eventId: string }
  | { type: "session:restoring"; sessionId: string; eventId: string }
  | { type: "session:created"; sessionId: string; modes: SessionModes }
  | { type: "session:closed"; sessionId: string; reason?: string }
  | { type: "error"; code: string; message: string; sessionId?: string }
  // Server-level events (incremental, best-effort delivery)
  | { type: "server:session_created"; session: SessionInfo }
  | { type: "server:session_closed"; sessionId: string }
  | { type: "server:session_deleted"; sessionId: string }
  | { type: "server:session_resumed"; sessionId: string }
  | { type: "server:repository_added"; repository: RepositoryInfo }
  | { type: "server:repository_removed"; repositoryId: string }
  | { type: "server:agents_changed"; agents: AgentListItem[] };

/** WebSocket message envelope from client to server */
export type ClientMessage =
  | { type: "session:prompt"; sessionId: string; prompt: Array<{ type: string; text: string }> }
  | { type: "session:cancel"; sessionId: string }
  | { type: "session:subscribe"; sessionId: string; lastEventId?: string }
  | { type: "session:permission_response"; sessionId: string; toolCallId: string; outcome: PermissionOutcome }
  | { type: "ping" };
