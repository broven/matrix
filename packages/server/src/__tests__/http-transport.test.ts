import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { createTransportRoutes } from "../api/transport/index.js";

describe("HTTP transport routes", () => {
  let app: Hono;
  let connectionManager: ConnectionManager;
  const serverToken = "secret-token";

  beforeEach(() => {
    connectionManager = new ConnectionManager();
    app = new Hono();
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken,
        snapshotProvider: (sessionId?: string) => [
          {
            type: "session:snapshot",
            sessionId: sessionId ?? "sess_1",
            eventId: "3",
            history: [
              {
                id: "h1",
                sessionId: sessionId ?? "sess_1",
                role: "agent",
                content: "snapshot text",
                timestamp: new Date().toISOString(),
              },
            ],
          },
        ],
        onPrompt: () => {},
        onPermissionResponse: () => {},
      }),
    );
  });

  it("accepts session prompts via POST /messages", async () => {
    let receivedSessionId = "";
    let receivedText = "";

    app = new Hono();
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken,
        snapshotProvider: () => [],
        onPrompt(sessionId, prompt) {
          receivedSessionId = sessionId;
          receivedText = prompt[0]?.text ?? "";
        },
        onPermissionResponse: () => {},
      }),
    );

    const res = await app.request("/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_1",
        prompt: [{ type: "text", text: "hello" }],
      }),
    });

    expect(res.status).toBe(202);
    expect(receivedSessionId).toBe("sess_1");
    expect(receivedText).toBe("hello");
  });

  it("returns a snapshot when poll falls behind the buffer", async () => {
    for (let i = 0; i < 510; i++) {
      connectionManager.broadcastToSession("sess_1", {
        type: "session:update",
        sessionId: "sess_1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `msg-${i}` },
        },
        eventId: "",
      });
    }

    const res = await app.request("/poll?lastEventId=1", {
      headers: {
        Authorization: `Bearer ${serverToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("session:snapshot");
    expect(body[0].history[0].content).toBe("snapshot text");
  });
});
