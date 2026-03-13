/** Unique session identifier */
export type SessionId = string;

/** Unique tool call identifier */
export type ToolCallId = string;

/** Session mode */
export interface SessionMode {
  id: string;
  name: string;
  description: string;
}

/** Session modes info */
export interface SessionModes {
  currentModeId: string;
  availableModes: SessionMode[];
}

/** Stop reason when a prompt turn ends */
export type StopReason = "end_turn" | "cancelled";

/** Prompt content can be text or a resource */
export type PromptContent =
  | { type: "text"; text: string }
  | { type: "resource"; resource: PromptResource };

export interface PromptResource {
  uri: string;
  mimeType: string;
  text: string;
}

/** Tool call kinds */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

/** Tool call status */
export type ToolCallStatus = "pending" | "running" | "completed" | "error";

/** Tool call location */
export interface ToolCallLocation {
  path: string;
}

/** Tool call content */
export type ToolCallContent =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string; newText: string };

/** Plan entry */
export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** Permission option kinds */
export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

/** Permission option */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/** Permission outcome */
export type PermissionOutcome =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

/** Session update types sent from server to client */
export type SessionUpdate =
  | {
      sessionUpdate: "agent_message_chunk";
      content: { type: "text"; text: string };
    }
  | {
      sessionUpdate: "plan";
      entries: PlanEntry[];
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: ToolCallId;
      title: string;
      kind: ToolKind;
      status: ToolCallStatus;
      locations?: ToolCallLocation[];
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: ToolCallId;
      status: ToolCallStatus;
      content?: ToolCallContent[];
    }
  | {
      sessionUpdate: "permission_request";
      toolCallId: ToolCallId;
      toolCall: {
        toolCallId: ToolCallId;
        title: string;
        kind: ToolKind;
        status: ToolCallStatus;
        content?: ToolCallContent[];
      };
      options: PermissionOption[];
    }
  | {
      sessionUpdate: "completed";
      stopReason: StopReason;
    };
