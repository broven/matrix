import type {
  SessionId,
  SessionUpdate,
  PromptContent,
  StopReason,
  HistoryEntry,
} from "@matrix/protocol";
import type { Transport } from "./transport/index.js";

export interface PromptCallbacks {
  onMessage?: (chunk: { type: "text"; text: string }) => void;
  onToolCall?: (toolCall: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>) => void;
  onToolCallUpdate?: (update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>) => void;
  onPermissionRequest?: (request: Extract<SessionUpdate, { sessionUpdate: "permission_request" }>) => void;
  onPlan?: (plan: Extract<SessionUpdate, { sessionUpdate: "plan" }>) => void;
  onComplete?: (result: { stopReason: StopReason }) => void;
  onHistorySync?: (history: HistoryEntry[]) => void;
}

export class MatrixSession {
  private callbacks: PromptCallbacks | null = null;
  private listeners = new Set<PromptCallbacks>();

  constructor(
    public readonly sessionId: SessionId,
    private transport: Transport,
    private restFetch: (path: string, init?: RequestInit) => Promise<Response>,
  ) {}

  prompt(text: string, callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.subscribe();
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  promptWithContent(content: PromptContent[], callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.subscribe();
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: content as Array<{ type: string; text: string }>,
    });
  }

  subscribe(lastEventId?: string): void {
    this.transport.send({
      type: "session:subscribe",
      sessionId: this.sessionId,
      lastEventId,
    } as Parameters<Transport["send"]>[0]);
  }

  subscribeToUpdates(callbacks: PromptCallbacks): () => void {
    this.listeners.add(callbacks);
    return () => {
      this.listeners.delete(callbacks);
    };
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

  async getHistory(): Promise<HistoryEntry[]> {
    const res = await this.restFetch(`/sessions/${this.sessionId}/history`);
    return res.json();
  }

  async close(): Promise<void> {
    await this.restFetch(`/sessions/${this.sessionId}`, { method: "DELETE" });
  }

  handleUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.dispatch((callbacks) => callbacks.onMessage?.(update.content));
        break;
      case "tool_call":
        this.dispatch((callbacks) => callbacks.onToolCall?.(update));
        break;
      case "tool_call_update":
        this.dispatch((callbacks) => callbacks.onToolCallUpdate?.(update));
        break;
      case "permission_request":
        this.dispatch((callbacks) => callbacks.onPermissionRequest?.(update));
        break;
      case "plan":
        this.dispatch((callbacks) => callbacks.onPlan?.(update));
        break;
      case "completed":
        this.dispatch((callbacks) => callbacks.onComplete?.({ stopReason: update.stopReason }));
        this.callbacks = null;
        break;
    }
  }

  handleSnapshot(history: HistoryEntry[]): void {
    this.dispatch((callbacks) => callbacks.onHistorySync?.(history));
  }

  private dispatch(fn: (callbacks: PromptCallbacks) => void): void {
    for (const listener of this.listeners) {
      fn(listener);
    }
    if (this.callbacks) {
      fn(this.callbacks);
    }
  }
}
