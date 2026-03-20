import { nanoid } from "nanoid";
import type { BridgeClientInfo, BridgeServerMessage } from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RegisteredClient {
  ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void };
  info: BridgeClientInfo;
  pendingRequests: Map<string, PendingRequest>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ClientRegistry {
  private clients = new Map<string, RegisteredClient>();

  register(
    ws: RegisteredClient["ws"],
    platform: string,
    label: string,
    userAgent?: string,
  ): string {
    let clientId = `${platform}-${label}`;

    // Handle duplicate IDs with suffix
    if (this.clients.has(clientId)) {
      let suffix = 2;
      while (this.clients.has(`${clientId}-${suffix}`)) suffix++;
      clientId = `${clientId}-${suffix}`;
    }

    this.clients.set(clientId, {
      ws,
      info: {
        clientId,
        platform,
        label,
        userAgent,
        connectedAt: Date.now(),
      },
      pendingRequests: new Map(),
    });

    return clientId;
  }

  unregister(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Reject all pending requests
    client.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Client "${clientId}" disconnected`));
    });
    client.pendingRequests.clear();
    this.clients.delete(clientId);
  }

  /** Remove the client associated with a given WebSocket instance. */
  unregisterByWs(ws: RegisteredClient["ws"]): string | null {
    let found: string | null = null;
    this.clients.forEach((client, clientId) => {
      if (client.ws === ws) {
        found = clientId;
      }
    });
    if (found) {
      this.unregister(found);
    }
    return found;
  }

  /**
   * Resolve a target client:
   * - explicit clientId → that client
   * - single connected client → that one
   * - multiple → first registered (insertion order)
   */
  getClient(clientId?: string): RegisteredClient | null {
    if (clientId) {
      return this.clients.get(clientId) ?? null;
    }
    // Default to first (or only) client
    const first = this.clients.values().next();
    return first.done ? null : first.value;
  }

  listClients(): BridgeClientInfo[] {
    return Array.from(this.clients.values()).map((c) => c.info);
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Send a request to a client and wait for the response.
   * Returns a promise that resolves with the client's response.
   */
  sendRequest(
    clientId: string | undefined,
    message: BridgeServerMessage,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    const client = this.getClient(clientId);
    if (!client) {
      return Promise.reject(
        new Error(clientId ? `Client "${clientId}" not found` : "No clients connected"),
      );
    }

    return new Promise((resolve, reject) => {
      const requestId = message.requestId;

      const timer = setTimeout(() => {
        client.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.pendingRequests.set(requestId, { resolve, reject, timer });
      client.ws.send(JSON.stringify(message));
    });
  }

  /**
   * Handle an incoming response from a client, resolving the pending promise.
   */
  handleResponse(
    clientId: string,
    requestId: string,
    result?: unknown,
    error?: string,
  ): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const pending = client.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    client.pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }

  generateRequestId(): string {
    return nanoid(12);
  }
}
