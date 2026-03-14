import type { ChildProcess } from "node:child_process";
import type { SessionUpdate, SessionId } from "@matrix/protocol";
import { encodeJsonRpc, parseJsonRpcMessages, type JsonRpcMessage } from "./jsonrpc.js";

export type BridgeEventHandler = {
  onSessionUpdate: (sessionId: SessionId, update: SessionUpdate) => void;
  onPermissionRequest: (sessionId: SessionId, request: JsonRpcMessage) => void;
  onError: (error: Error) => void;
  onClose: () => void;
};

export class AcpBridge {
  private buffer = "";
  private nextId = 1;
  private permissionRequests = new Map<string, number | string>();
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

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
      this.handlers.onClose();
    });

    this.process.on("error", (err) => {
      this.handlers.onError(err);
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    this.write(message);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  notify(method: string, params: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.write(message);
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo,
    });
  }

  async createSession(cwd: string): Promise<unknown> {
    return this.request("session/new", { cwd });
  }

  async sendPrompt(sessionId: SessionId, prompt: Array<{ type: string; text: string }>): Promise<unknown> {
    return this.request("session/prompt", { sessionId, prompt });
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
    this.process.kill();
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
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === "session/update" && msg.params) {
      const params = msg.params as { sessionId: string; update: SessionUpdate };
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
