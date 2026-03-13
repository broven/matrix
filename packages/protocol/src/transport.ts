import type { SessionUpdate, SessionModes, PermissionOutcome } from "./session.js";

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
  | { type: "session:created"; sessionId: string; modes: SessionModes }
  | { type: "session:closed"; sessionId: string }
  | { type: "error"; code: string; message: string };

/** WebSocket message envelope from client to server */
export type ClientMessage =
  | { type: "session:prompt"; sessionId: string; prompt: Array<{ type: string; text: string }> }
  | { type: "session:permission_response"; sessionId: string; toolCallId: string; outcome: PermissionOutcome }
  | { type: "ping" };
