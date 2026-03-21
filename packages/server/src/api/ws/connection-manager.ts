import type { ServerMessage } from "@matrix/protocol";

interface ClientConnection {
  sender: { send: (data: string) => void };
  lastEventId: number;
  subscribedSessions: Set<string>;
}

export class ConnectionManager {
  private connections = new Map<string, ClientConnection>();
  private messageBuffers = new Map<string, Array<{ eventId: number; message: ServerMessage }>>();
  private eventLog: Array<{ eventId: number; message: ServerMessage }> = [];
  private listeners = new Set<(message: ServerMessage) => void>();
  private eventCounter = 0;
  private static readonly MAX_BUFFER_SIZE = 500;

  addConnection(connectionId: string, sender: { send: (data: string) => void }): void {
    this.connections.set(connectionId, {
      sender,
      lastEventId: 0,
      subscribedSessions: new Set(),
    });
  }

  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  subscribeToSession(connectionId: string, sessionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.subscribedSessions.add(sessionId);
    }
  }

  broadcastToSession(sessionId: string, message: ServerMessage): void {
    const eventId = ++this.eventCounter;
    const enrichedMessage = { ...message, eventId: String(eventId) };

    if (!this.messageBuffers.has(sessionId)) {
      this.messageBuffers.set(sessionId, []);
    }
    const buffer = this.messageBuffers.get(sessionId)!;
    buffer.push({ eventId, message: enrichedMessage });
    if (buffer.length > ConnectionManager.MAX_BUFFER_SIZE) {
      buffer.shift();
    }
    this.eventLog.push({ eventId, message: enrichedMessage });
    if (this.eventLog.length > ConnectionManager.MAX_BUFFER_SIZE) {
      this.eventLog.shift();
    }
    for (const listener of this.listeners) {
      listener(enrichedMessage);
    }

    for (const [, conn] of this.connections) {
      if (conn.subscribedSessions.has(sessionId)) {
        conn.sender.send(JSON.stringify(enrichedMessage));
        conn.lastEventId = eventId;
      }
    }
  }

  /** Broadcast a server-level event to all connected clients (no eventId, no buffering). */
  broadcastToAll(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const [, conn] of this.connections) {
      conn.sender.send(data);
    }
  }

  replayMissed(connectionId: string, sessionId: string, lastEventId: number): boolean {
    const conn = this.connections.get(connectionId);
    const buffer = this.messageBuffers.get(sessionId);
    if (!conn || !buffer) return true;

    if (buffer.length > 0 && lastEventId > 0 && lastEventId < buffer[0].eventId) {
      return false;
    }

    for (const entry of buffer) {
      if (entry.eventId > lastEventId) {
        conn.sender.send(JSON.stringify(entry.message));
      }
    }
    return true;
  }

  getMessagesSince(lastEventId: number): { messages: ServerMessage[]; needsSnapshot: boolean } {
    if (this.eventLog.length === 0) {
      return { messages: [], needsSnapshot: false };
    }

    if (lastEventId > 0 && lastEventId < this.eventLog[0].eventId) {
      return { messages: [], needsSnapshot: true };
    }

    return {
      messages: this.eventLog
        .filter((entry) => entry.eventId > lastEventId)
        .map((entry) => entry.message),
      needsSnapshot: false,
    };
  }

  getCurrentEventId(): number {
    return this.eventCounter;
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
