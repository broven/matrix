import type { ServerMessage } from "@matrix/protocol";

interface ClientConnection {
  ws: { send: (data: string) => void };
  lastEventId: number;
  subscribedSessions: Set<string>;
}

export class ConnectionManager {
  private connections = new Map<string, ClientConnection>();
  private messageBuffers = new Map<string, Array<{ eventId: number; message: ServerMessage }>>();
  private eventCounter = 0;
  private static readonly MAX_BUFFER_SIZE = 500;

  addConnection(connectionId: string, ws: { send: (data: string) => void }): void {
    this.connections.set(connectionId, {
      ws,
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

    for (const [, conn] of this.connections) {
      if (conn.subscribedSessions.has(sessionId)) {
        conn.ws.send(JSON.stringify(enrichedMessage));
        conn.lastEventId = eventId;
      }
    }
  }

  replayMissed(connectionId: string, sessionId: string, lastEventId: number): void {
    const conn = this.connections.get(connectionId);
    const buffer = this.messageBuffers.get(sessionId);
    if (!conn || !buffer) return;

    for (const entry of buffer) {
      if (entry.eventId > lastEventId) {
        conn.ws.send(JSON.stringify(entry.message));
      }
    }
  }
}
