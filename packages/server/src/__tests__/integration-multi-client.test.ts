import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionManager } from "../api/ws/connection-manager.js";

describe("Integration: multiple clients", () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager();
  });

  it("two clients subscribed to the same session both receive updates", () => {
    const client1Messages: string[] = [];
    const client2Messages: string[] = [];

    const ws1 = { send: (data: string) => client1Messages.push(data) };
    const ws2 = { send: (data: string) => client2Messages.push(data) };

    connectionManager.addConnection("client1", ws1);
    connectionManager.addConnection("client2", ws2);
    connectionManager.subscribeToSession("client1", "sess_shared");
    connectionManager.subscribeToSession("client2", "sess_shared");

    connectionManager.broadcastToSession("sess_shared", {
      type: "session:update",
      sessionId: "sess_shared",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "shared message" },
      },
      eventId: "",
    });

    expect(client1Messages).toHaveLength(1);
    expect(client2Messages).toHaveLength(1);

    const parsed1 = JSON.parse(client1Messages[0]);
    const parsed2 = JSON.parse(client2Messages[0]);
    expect(parsed1.update.content.text).toBe("shared message");
    expect(parsed2.update.content.text).toBe("shared message");
    // Both should have the same eventId
    expect(parsed1.eventId).toBe(parsed2.eventId);
  });

  it("client subscribed to different session does not receive messages", () => {
    const client1Messages: string[] = [];
    const client2Messages: string[] = [];

    const ws1 = { send: (data: string) => client1Messages.push(data) };
    const ws2 = { send: (data: string) => client2Messages.push(data) };

    connectionManager.addConnection("client1", ws1);
    connectionManager.addConnection("client2", ws2);
    connectionManager.subscribeToSession("client1", "sess_a");
    connectionManager.subscribeToSession("client2", "sess_b");

    connectionManager.broadcastToSession("sess_a", {
      type: "session:update",
      sessionId: "sess_a",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "only for A" },
      },
      eventId: "",
    });

    expect(client1Messages).toHaveLength(1);
    expect(client2Messages).toHaveLength(0);
  });

  it("client can subscribe to multiple sessions", () => {
    const messages: string[] = [];
    const ws = { send: (data: string) => messages.push(data) };

    connectionManager.addConnection("multi-client", ws);
    connectionManager.subscribeToSession("multi-client", "sess_x");
    connectionManager.subscribeToSession("multi-client", "sess_y");

    connectionManager.broadcastToSession("sess_x", {
      type: "session:update",
      sessionId: "sess_x",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "from X" },
      },
      eventId: "",
    });

    connectionManager.broadcastToSession("sess_y", {
      type: "session:update",
      sessionId: "sess_y",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "from Y" },
      },
      eventId: "",
    });

    expect(messages).toHaveLength(2);
    const parsed0 = JSON.parse(messages[0]);
    const parsed1 = JSON.parse(messages[1]);
    expect(parsed0.sessionId).toBe("sess_x");
    expect(parsed1.sessionId).toBe("sess_y");
  });

  it("removing one client does not affect another", () => {
    const client1Messages: string[] = [];
    const client2Messages: string[] = [];

    const ws1 = { send: (data: string) => client1Messages.push(data) };
    const ws2 = { send: (data: string) => client2Messages.push(data) };

    connectionManager.addConnection("client1", ws1);
    connectionManager.addConnection("client2", ws2);
    connectionManager.subscribeToSession("client1", "sess_1");
    connectionManager.subscribeToSession("client2", "sess_1");

    // Remove client1
    connectionManager.removeConnection("client1");

    connectionManager.broadcastToSession("sess_1", {
      type: "session:update",
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "after removal" },
      },
      eventId: "",
    });

    expect(client1Messages).toHaveLength(0);
    expect(client2Messages).toHaveLength(1);
  });
});
