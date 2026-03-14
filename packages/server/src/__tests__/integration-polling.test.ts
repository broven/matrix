import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createTransportRoutes } from "../api/transport/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";

const TOKEN = "poll-test-token";

describe("Integration: polling transport", () => {
  let app: Hono;
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager();
    app = new Hono();
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken: TOKEN,
        snapshotProvider: () => [
          {
            type: "session:snapshot" as const,
            sessionId: "sess_1",
            history: [
              {
                id: "h1",
                sessionId: "sess_1",
                role: "agent" as const,
                type: "text" as const,
                content: "snapshot content",
                timestamp: new Date().toISOString(),
              },
            ],
            eventId: "0",
          },
        ],
        onPrompt: () => {},
        onPermissionResponse: () => {},
      }),
    );
  });

  it("GET /poll returns empty array when no events", async () => {
    const res = await app.request("/poll?lastEventId=0", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /poll returns buffered messages since lastEventId", async () => {
    // Setup a subscriber so broadcasts go to the buffer
    const ws = { send: () => {} };
    connectionManager.addConnection("bg", ws);
    connectionManager.subscribeToSession("bg", "sess_1");

    // Broadcast 3 messages
    for (let i = 0; i < 3; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `poll msg ${i}` },
        },
        eventId: "",
      });
    }

    // Poll from 0 - should get all 3
    const res = await app.request("/poll?lastEventId=0", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body[0].type).toBe("session:update");
    expect(body[2].update.content.text).toBe("poll msg 2");

    // Poll from event 2 - should get only event 3
    const res2 = await app.request("/poll?lastEventId=2", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body2 = await res2.json();
    expect(body2).toHaveLength(1);
    expect(body2[0].update.content.text).toBe("poll msg 2");
  });

  it("GET /poll returns snapshot when buffer is exceeded", async () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("bg", ws);
    connectionManager.subscribeToSession("bg", "sess_1");

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

    const res = await app.request("/poll?lastEventId=1", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("session:snapshot");
    expect(body[0].history[0].content).toBe("snapshot content");
  });

  it("GET /poll accepts Last-Event-ID header", async () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("bg", ws);
    connectionManager.subscribeToSession("bg", "sess_1");

    connectionManager.broadcastToSession("sess_1", {
      type: "session:update",
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "header test" },
      },
      eventId: "",
    });

    const res = await app.request("/poll", {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Last-Event-ID": "0",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});
