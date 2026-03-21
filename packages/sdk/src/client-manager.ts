import { MatrixClient } from "./client.js";
import type { ConnectionStatus } from "@matrix/protocol";

export interface ServerConnection {
  serverId: string;
  serverUrl: string;
  token: string;
}

type StatusListener = (serverId: string, status: ConnectionStatus) => void;
type ErrorListener = (serverId: string, error: Error) => void;

/**
 * Manages multiple MatrixClient instances for simultaneous server connections.
 * Each server gets its own independent client with its own transport.
 */
export class ClientManager {
  private clients = new Map<string, MatrixClient>();
  private statusListeners = new Set<StatusListener>();
  private errorListeners = new Set<ErrorListener>();

  /** Connect to a server. If already connected, returns existing client. */
  connect(serverId: string, config: { serverUrl: string; token: string }): MatrixClient {
    const existing = this.clients.get(serverId);
    if (existing) {
      return existing;
    }

    const client = new MatrixClient({
      serverUrl: config.serverUrl,
      token: config.token,
    });

    client.onStatusChange((status) => {
      for (const listener of this.statusListeners) {
        listener(serverId, status);
      }
    });

    client.onError((error) => {
      for (const listener of this.errorListeners) {
        listener(serverId, error);
      }
    });

    this.clients.set(serverId, client);
    client.connect();
    return client;
  }

  /** Disconnect a specific server. */
  disconnect(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
    }
  }

  /** Get client for a specific server. */
  getClient(serverId: string): MatrixClient | null {
    return this.clients.get(serverId) ?? null;
  }

  /** Get all connected clients. */
  getConnectedClients(): Map<string, MatrixClient> {
    return new Map(this.clients);
  }

  /** Disconnect all servers. */
  disconnectAll(): void {
    for (const [, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
  }

  /** Register a status change listener for any server. */
  onStatusChange(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    return () => { this.statusListeners.delete(callback); };
  }

  /** Register an error listener for any server. */
  onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback);
    return () => { this.errorListeners.delete(callback); };
  }
}
