import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createTransportRoutes } from "../api/transport/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";

const TOKEN = "sse-test-token";

describe("Integration: SSE transport", () => {
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
            history: [],
            eventId: "0",
          },
        ],
        onPrompt: () => {},
        onCancel: () => {},
        onPermissionResponse: () => {},
      }),
    );
  });

  it("GET /sse returns text/event-stream content type", async () => {
    const res = await app.request(`/sse?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("GET /sse streams initial events readable from body", async () => {
    // Broadcast some events before connecting SSE
    const ws = { send: () => {} };
    connectionManager.addConnection("bg", ws);
    connectionManager.subscribeToSession("bg", "sess_1");
    connectionManager.broadcastToSession("sess_1", {
      type: "session:update",
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from sse" },
      },
      eventId: "",
    });

    const res = await app.request(`/sse?token=${TOKEN}&lastEventId=0`);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    // Read just the first chunk from the stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    reader.cancel();

    expect(text).toContain("data:");
    expect(text).toContain("session:update");
    expect(text).toContain("hello from sse");
  });

  it("GET /sse sends snapshot when lastEventId is too old", async () => {
    const ws = { send: () => {} };
    connectionManager.addConnection("bg", ws);
    connectionManager.subscribeToSession("bg", "sess_1");

    // Fill buffer beyond capacity
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

    const res = await app.request(`/sse?token=${TOKEN}&lastEventId=1`);
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    reader.cancel();

    expect(text).toContain("session:snapshot");
  });

  it("GET /sse rejects invalid token", async () => {
    const res = await app.request("/sse?token=wrong");
    expect(res.status).toBe(401);
  });
});
