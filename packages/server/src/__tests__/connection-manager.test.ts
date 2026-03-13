import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionManager } from "../api/ws/connection-manager.js";

describe("ConnectionManager", () => {
  let manager: ConnectionManager;
  let sentMessages: string[];
  let mockWs: { send: (data: string) => void };

  beforeEach(() => {
    manager = new ConnectionManager();
    sentMessages = [];
    mockWs = { send: (data: string) => sentMessages.push(data) };
  });

  it("adds and removes connections", () => {
    manager.addConnection("conn1", mockWs);
    manager.removeConnection("conn1");
    // no error = success
  });

  it("broadcasts to subscribed connections", () => {
    manager.addConnection("conn1", mockWs);
    manager.subscribeToSession("conn1", "sess1");
    manager.broadcastToSession("sess1", {
      type: "session:update",
      sessionId: "sess1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      eventId: "",
    });
    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe("session:update");
  });

  it("does not broadcast to unsubscribed connections", () => {
    manager.addConnection("conn1", mockWs);
    manager.broadcastToSession("sess1", {
      type: "session:closed",
      sessionId: "sess1",
    });
    expect(sentMessages).toHaveLength(0);
  });

  it("replays missed messages", () => {
    manager.addConnection("conn1", mockWs);
    manager.subscribeToSession("conn1", "sess1");

    // Send 3 messages
    for (let i = 0; i < 3; i++) {
      manager.broadcastToSession("sess1", {
        type: "session:update",
        sessionId: "sess1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `msg${i}` } },
        eventId: "",
      });
    }

    // New connection, replay from eventId 1
    const newMessages: string[] = [];
    const newWs = { send: (data: string) => newMessages.push(data) };
    manager.addConnection("conn2", newWs);
    manager.subscribeToSession("conn2", "sess1");
    manager.replayMissed("conn2", "sess1", 1);
    expect(newMessages.length).toBe(2); // eventId 2 and 3
  });
});
