import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionManager } from "../api/ws/connection-manager.js";

describe("Integration: WebSocket reconnection with message replay", () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager();
  });

  it("reconnecting client receives missed messages via replayMissed", () => {
    // Client 1 connects and subscribes
    const client1Messages: string[] = [];
    const ws1 = { send: (data: string) => client1Messages.push(data) };
    connectionManager.addConnection("client1", ws1);
    connectionManager.subscribeToSession("client1", "sess_1");

    // Send 5 messages
    for (let i = 0; i < 5; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `message ${i}` },
        },
        eventId: "",
      });
    }
    expect(client1Messages).toHaveLength(5);

    // Client 1 disconnects
    connectionManager.removeConnection("client1");

    // Send 3 more messages while disconnected
    for (let i = 5; i < 8; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `message ${i}` },
        },
        eventId: "",
      });
    }

    // Client 1 reconnects with lastEventId = 5
    const reconnectMessages: string[] = [];
    const ws1Reconnect = { send: (data: string) => reconnectMessages.push(data) };
    connectionManager.addConnection("client1-reconnect", ws1Reconnect);
    connectionManager.subscribeToSession("client1-reconnect", "sess_1");
    const replayed = connectionManager.replayMissed("client1-reconnect", "sess_1", 5);

    expect(replayed).toBe(true);
    // Should receive messages 6, 7, 8 (eventIds 6, 7, 8)
    expect(reconnectMessages).toHaveLength(3);
    for (const msg of reconnectMessages) {
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("session:update");
      expect(parseInt(parsed.eventId, 10)).toBeGreaterThan(5);
    }
  });

  it("returns false when client missed more than buffer allows", () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("c1", ws);
    connectionManager.subscribeToSession("c1", "sess_1");

    // Fill up beyond buffer size (500 messages)
    for (let i = 0; i < 510; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `msg ${i}` },
        },
        eventId: "",
      });
    }

    // New client tries to replay from eventId 1 (already evicted from buffer)
    const newMessages: string[] = [];
    const newWs = { send: (data: string) => newMessages.push(data) };
    connectionManager.addConnection("c2", newWs);
    connectionManager.subscribeToSession("c2", "sess_1");
    const replayed = connectionManager.replayMissed("c2", "sess_1", 1);

    // Should return false = needs snapshot
    expect(replayed).toBe(false);
    expect(newMessages).toHaveLength(0);
  });

  it("getMessagesSince returns needsSnapshot when eventId is too old", () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("c1", ws);
    connectionManager.subscribeToSession("c1", "sess_1");

    for (let i = 0; i < 510; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `msg ${i}` },
        },
        eventId: "",
      });
    }

    const result = connectionManager.getMessagesSince(1);
    expect(result.needsSnapshot).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it("getMessagesSince returns buffered messages for valid lastEventId", () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("c1", ws);
    connectionManager.subscribeToSession("c1", "sess_1");

    for (let i = 0; i < 5; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `msg ${i}` },
        },
        eventId: "",
      });
    }

    const result = connectionManager.getMessagesSince(3);
    expect(result.needsSnapshot).toBe(false);
    expect(result.messages).toHaveLength(2); // eventIds 4 and 5
  });
});
