import type { ChildProcess } from "node:child_process";
import type { AgentCapabilities, SessionUpdate, SessionId } from "@matrix/protocol";
import { encodeJsonRpc, parseJsonRpcMessages, type JsonRpcMessage } from "./jsonrpc.js";

export type BridgeEventHandler = {
  onSessionUpdate: (sessionId: SessionId, update: SessionUpdate) => void;
  onPermissionRequest: (sessionId: SessionId, request: JsonRpcMessage) => void;
  onError: (error: Error) => void;
  onClose: () => void;
};

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export const REQUEST_TIMEOUT_MS = 60_000;

interface InitializeResult {
  capabilities?: AgentCapabilities;
  serverCapabilities?: AgentCapabilities;
}

export class AcpBridge {
  private buffer = "";
  private nextId = 1;
  private permissionRequests = new Map<string, number | string>();
  private promptRequests = new Map<number | string, {
    sessionId: SessionId;
    agentSessionId: string;
    sawCompleted: boolean;
  }>();
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }>();
  /** The agent's internal session ID returned by session/new */
  public agentSessionId: string | null = null;
  public capabilities: AgentCapabilities | null = null;

  constructor(
    private process: ChildProcess,
    private handlers: BridgeEventHandler,
  ) {
    this.process.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr!.on("data", (data: Buffer) => {
      console.error(`[agent stderr] ${data.toString()}`);
    });

    this.process.on("close", () => {
      this.rejectAllPending(new Error("Agent process closed"));
      this.handlers.onClose();
    });

    this.process.on("error", (err) => {
      this.handlers.onError(err);
    });
  }

  async request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    this.write(message);

    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pendingRequests.delete(id);
            reject(new TimeoutError(`Request ${method} (id=${id}) timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
      this.pendingRequests.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.write(message);
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<InitializeResult> {
    const result = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo,
    }) as InitializeResult;
    this.capabilities = result.serverCapabilities ?? result.capabilities ?? null;
    return result;
  }

  async createSession(cwd: string): Promise<unknown> {
    const result = await this.request("session/new", { cwd, mcpServers: [] }) as { sessionId?: string };
    if (result?.sessionId) {
      this.agentSessionId = result.sessionId;
    }
    return result;
  }

  async loadSession(agentSessionId: string, cwd: string): Promise<unknown> {
    const result = await this.request("session/load", {
      sessionId: agentSessionId,
      cwd,
      mcpServers: [],
    }) as { sessionId?: string };
    if (result?.sessionId) {
      this.agentSessionId = result.sessionId;
    } else {
      this.agentSessionId = agentSessionId;
    }
    return result;
  }

  async sendPrompt(sessionId: SessionId, prompt: Array<{ type: string; text: string }>): Promise<unknown> {
    // Use the agent's internal session ID, not Matrix's session ID
    const agentSid = this.agentSessionId || sessionId;
    const id = this.nextId++;
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: { sessionId: agentSid, prompt },
    };

    this.promptRequests.set(id, { sessionId, agentSessionId: agentSid, sawCompleted: false });
    this.write(message);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, timer: null });
    });
  }

  respondPermission(toolCallId: string, outcome: { outcome: string; optionId?: string }): void {
    const requestId = this.permissionRequests.get(toolCallId);
    if (requestId === undefined) {
      throw new Error(`Unknown permission request for tool call ${toolCallId}`);
    }
    this.permissionRequests.delete(toolCallId);
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: requestId,
      result: { outcome },
    };
    this.write(message);
  }

  destroy(): void {
    this.rejectAllPending(new Error("Bridge destroyed"));
    this.process.kill();
  }

  private rejectAllPending(error: Error): void {
    this.promptRequests.clear();
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private write(message: JsonRpcMessage): void {
    const encoded = encodeJsonRpc(message);
    this.process.stdin!.write(encoded);
  }

  private processBuffer(): void {
    const { messages, remainder } = parseJsonRpcMessages(this.buffer);
    this.buffer = remainder;

    for (const msg of messages) {
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        const promptRequest = this.promptRequests.get(msg.id);
        this.promptRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          if (promptRequest && !promptRequest.sawCompleted) {
            this.handlers.onSessionUpdate(promptRequest.sessionId, {
              sessionUpdate: "completed",
              stopReason: "end_turn",
            });
          }
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === "session/update" && msg.params) {
      const params = msg.params as { sessionId: string; update: SessionUpdate };
      if (params.update.sessionUpdate === "completed") {
        for (const promptRequest of this.promptRequests.values()) {
          if (promptRequest.agentSessionId === params.sessionId) {
            promptRequest.sawCompleted = true;
          }
        }
      }
      this.handlers.onSessionUpdate(params.sessionId, params.update);
      return;
    }

    if (msg.method === "session/request_permission" && msg.id !== undefined) {
      const toolCallId = (msg.params as { toolCall: { toolCallId: string } }).toolCall.toolCallId;
      this.permissionRequests.set(toolCallId, msg.id);
      this.handlers.onPermissionRequest(
        (msg.params as { sessionId: string }).sessionId,
        msg,
      );
      return;
    }
  }
}
