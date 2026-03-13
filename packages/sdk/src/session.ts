import type {
  SessionId,
  SessionUpdate,
  PromptContent,
  PermissionOutcome,
  StopReason,
} from "@matrix/protocol";
import type { Transport } from "./transport/index.js";

export interface PromptCallbacks {
  onMessage?: (chunk: { type: "text"; text: string }) => void;
  onToolCall?: (toolCall: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>) => void;
  onToolCallUpdate?: (update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>) => void;
  onPermissionRequest?: (request: Extract<SessionUpdate, { sessionUpdate: "permission_request" }>) => void;
  onPlan?: (plan: Extract<SessionUpdate, { sessionUpdate: "plan" }>) => void;
  onComplete?: (result: { stopReason: StopReason }) => void;
}

export class MatrixSession {
  private callbacks: PromptCallbacks | null = null;

  constructor(
    public readonly sessionId: SessionId,
    private transport: Transport,
    private restFetch: (path: string, init?: RequestInit) => Promise<Response>,
  ) {}

  prompt(text: string, callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  promptWithContent(content: PromptContent[], callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: content as Array<{ type: string; text: string }>,
    });
  }

  approveToolCall(toolCallId: string, optionId = "allow-once"): void {
    this.transport.send({
      type: "session:permission_response",
      sessionId: this.sessionId,
      toolCallId,
      outcome: { outcome: "selected", optionId },
    });
  }

  rejectToolCall(toolCallId: string, optionId = "reject-once"): void {
    this.transport.send({
      type: "session:permission_response",
      sessionId: this.sessionId,
      toolCallId,
      outcome: { outcome: "selected", optionId },
    });
  }

  async getHistory() {
    const res = await this.restFetch(`/sessions/${this.sessionId}/history`);
    return res.json();
  }

  async close(): Promise<void> {
    await this.restFetch(`/sessions/${this.sessionId}`, { method: "DELETE" });
  }

  handleUpdate(update: SessionUpdate): void {
    if (!this.callbacks) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.callbacks.onMessage?.(update.content);
        break;
      case "tool_call":
        this.callbacks.onToolCall?.(update);
        break;
      case "tool_call_update":
        this.callbacks.onToolCallUpdate?.(update);
        break;
      case "permission_request":
        this.callbacks.onPermissionRequest?.(update);
        break;
      case "plan":
        this.callbacks.onPlan?.(update);
        break;
      case "completed":
        this.callbacks.onComplete?.({ stopReason: update.stopReason });
        this.callbacks = null;
        break;
    }
  }
}
