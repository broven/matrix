/** WebSocket protocol types for the automation bridge. */

// --- Client → Server messages ---

export interface BridgeRegisterMessage {
  type: "register";
  platform: string;
  label: string;
  userAgent?: string;
}

export interface BridgeResponseMessage {
  type: "response";
  requestId: string;
  result?: unknown;
  error?: string;
}

export interface BridgeHeartbeatMessage {
  type: "heartbeat";
}

export type BridgeClientMessage =
  | BridgeRegisterMessage
  | BridgeResponseMessage
  | BridgeHeartbeatMessage;

// --- Server → Client messages ---

export interface BridgeEvalMessage {
  type: "eval";
  requestId: string;
  script: string;
}

export interface BridgeEventMessage {
  type: "event";
  requestId: string;
  name: string;
  payload?: unknown;
}

export interface BridgeResetMessage {
  type: "reset";
  requestId: string;
  scopes?: string[];
}

export type BridgeServerMessage =
  | BridgeEvalMessage
  | BridgeEventMessage
  | BridgeResetMessage;

// --- Client info ---

export interface BridgeClientInfo {
  clientId: string;
  platform: string;
  label: string;
  userAgent?: string;
  connectedAt: number;
}
