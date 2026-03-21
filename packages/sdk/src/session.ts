import type {
  SessionId,
  SessionUpdate,
  PromptContent,
  StopReason,
  HistoryEntry,
  AvailableCommand,
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
  onSuspended?: () => void;
  onRestoring?: () => void;
  onAvailableCommands?: (commands: AvailableCommand[]) => void;
  onError?: (error: { code: string; message: string }) => void;
}

interface QueuedResolver {
  resolve: (result: IteratorResult<SessionUpdate>) => void;
}

export class MatrixSession implements AsyncIterable<SessionUpdate> {
  private callbacks: PromptCallbacks | null = null;
  private listeners = new Set<PromptCallbacks>();
  availableCommands: AvailableCommand[] = [];

  /** Async iterator state */
  private iteratorBuffer: SessionUpdate[] = [];
  private iteratorWaiters: QueuedResolver[] = [];
  private iteratorDone = false;

  constructor(
    public readonly sessionId: SessionId,
    private transport: Transport,
    private restFetch: (path: string, init?: RequestInit) => Promise<Response>,
  ) {}

  prompt(text: string, callbacks: PromptCallbacks): void {
    this.subscribe();
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  promptWithContent(content: PromptContent[], callbacks: PromptCallbacks): void {
    this.subscribe();
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: content,
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

  cancel(): void {
    this.transport.send({
      type: "session:cancel",
      sessionId: this.sessionId,
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

  async getHistory(): Promise<HistoryEntry[]> {
    const res = await this.restFetch(`/sessions/${this.sessionId}/history`);
    return res.json();
  }

  async close(): Promise<void> {
    await this.restFetch(`/sessions/${this.sessionId}`, { method: "DELETE" });
  }

  handleUpdate(update: SessionUpdate): void {
    this.pushToIterator(update);

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
      case "available_commands_update":
        this.availableCommands = update.availableCommands;
        this.dispatch((callbacks) => callbacks.onAvailableCommands?.(update.availableCommands));
        break;
      case "completed":
        this.dispatch((callbacks) => callbacks.onComplete?.({ stopReason: update.stopReason }));
        this.callbacks = null;
        break;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SessionUpdate> {
    // Reset completion state but preserve any buffered updates
    this.iteratorWaiters = [];
    this.iteratorDone = false;

    return {
      next: (): Promise<IteratorResult<SessionUpdate>> => {
        if (this.iteratorBuffer.length > 0) {
          const value = this.iteratorBuffer.shift()!;
          const done = value.sessionUpdate === "completed";
          if (done) {
            this.iteratorDone = true;
          }
          return Promise.resolve({ value, done: false });
        }

        if (this.iteratorDone) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<SessionUpdate>>((resolve) => {
          this.iteratorWaiters.push({ resolve });
        });
      },

      return: (): Promise<IteratorResult<SessionUpdate>> => {
        this.iteratorDone = true;
        // Resolve any pending waiters
        for (const waiter of this.iteratorWaiters) {
          waiter.resolve({ value: undefined, done: true });
        }
        this.iteratorWaiters = [];
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }

  private pushToIterator(update: SessionUpdate): void {
    if (this.iteratorDone) return;

    if (this.iteratorWaiters.length > 0) {
      const waiter = this.iteratorWaiters.shift()!;
      if (update.sessionUpdate === "completed") {
        this.iteratorDone = true;
      }
      waiter.resolve({ value: update, done: false });
    } else {
      this.iteratorBuffer.push(update);
    }
  }

  handleSnapshot(history: HistoryEntry[]): void {
    this.dispatch((callbacks) => callbacks.onHistorySync?.(history));
  }

  handleSuspended(): void {
    this.dispatch((callbacks) => callbacks.onSuspended?.());
  }

  handleRestoring(): void {
    this.dispatch((callbacks) => callbacks.onRestoring?.());
  }

  handleError(error: { code: string; message: string }): void {
    this.dispatch((callbacks) => callbacks.onError?.(error));
    this.callbacks = null;
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
