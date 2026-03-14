import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { createTransportRoutes } from "../api/transport/index.js";
import { authMiddleware } from "../auth/middleware.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { SessionManager } from "../session-manager/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-integration-auth.db";
const TOKEN = "correct-token";

describe("Integration: auth rejection", () => {
  let app: Hono;
  let store: Store;

  beforeEach(() => {
    for (const ext of ["", "-wal", "-shm"]) {
      try { unlinkSync(DB_PATH + ext); } catch {}
    }
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });

    store = new Store(DB_PATH);
    const connectionManager = new ConnectionManager();

    app = new Hono();
    app.use("/agents/*", authMiddleware(TOKEN));
    app.use("/sessions/*", authMiddleware(TOKEN));

    const sessionManager = new SessionManager();
    app.route("/", createRestRoutes(agentManager, store, sessionManager));
    app.route(
      "/",
      createTransportRoutes({
        connectionManager,
        serverToken: TOKEN,
        snapshotProvider: () => [],
        onPrompt: () => {},
        onPermissionResponse: () => {},
      }),
    );
  });

  afterEach(() => {
    store.close();
    for (const ext of ["", "-wal", "-shm"]) {
      try { unlinkSync(DB_PATH + ext); } catch {}
    }
  });

  it("GET /agents rejects missing token", async () => {
    const res = await app.request("/agents");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  it("GET /agents rejects wrong token", async () => {
    const res = await app.request("/agents", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid token");
  });

  it("GET /sessions rejects missing token", async () => {
    const res = await app.request("/sessions");
    expect(res.status).toBe(401);
  });

  it("GET /sessions/:id/history rejects missing token", async () => {
    store.createSession("sess_1", "test-agent", "/tmp");
    const res = await app.request("/sessions/sess_1/history");
    expect(res.status).toBe(401);
  });

  it("DELETE /sessions/:id rejects missing token", async () => {
    store.createSession("sess_1", "test-agent", "/tmp");
    const res = await app.request("/sessions/sess_1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("POST /messages rejects missing token", async () => {
    const res = await app.request("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_1",
        prompt: [{ type: "text", text: "hello" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /messages rejects wrong token", async () => {
    const res = await app.request("/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer bad-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "session:prompt",
        sessionId: "sess_1",
        prompt: [{ type: "text", text: "hello" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /poll rejects missing token", async () => {
    const res = await app.request("/poll?lastEventId=0");
    expect(res.status).toBe(401);
  });

  it("GET /sse rejects missing token", async () => {
    const res = await app.request("/sse");
    expect(res.status).toBe(401);
  });

  it("GET /sse rejects wrong token", async () => {
    const res = await app.request("/sse?token=wrong-token");
    expect(res.status).toBe(401);
  });

  it("GET /agents succeeds with correct token", async () => {
    const res = await app.request("/agents", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});
