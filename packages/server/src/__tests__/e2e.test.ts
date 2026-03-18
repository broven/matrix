import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { unlinkSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Writable, PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { generateToken } from "../auth/token.js";
import { authMiddleware } from "../auth/middleware.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { AcpBridge } from "../acp-bridge/index.js";
import { createRestRoutes } from "../api/rest/index.js";
import { createTransportRoutes } from "../api/transport/index.js";
import { ConnectionManager } from "../api/ws/connection-manager.js";
import { SessionManager } from "../session-manager/index.js";
import { WorktreeManager } from "../worktree-manager/index.js";

const DB_PATH = "/tmp/matrix-e2e-test.db";

/**
 * Respond to a JSON-RPC message on the given stdout stream.
 *
 * IMPORTANT: All writes to stdout are deferred with setImmediate().
 * This avoids a synchronous re-entrancy issue in AcpBridge.request():
 *   1. request() calls this.write() which triggers stdin handler synchronously
 *   2. stdin handler writes response to stdout synchronously
 *   3. stdout data handler resolves the pending request
 *   BUT step 3 fires before pendingRequests.set() in the Promise constructor
 *   that runs after this.write() returns.
 *
 * By deferring, we ensure the Promise constructor registers the pending
 * request before the response arrives.
 */
function handleMockMessage(msg: any, stdout: PassThrough): void {
  if (msg.method === "initialize") {
    setImmediate(() => {
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: 1,
          serverCapabilities: { session: true, loadSession: true },
          serverInfo: { name: "mock-agent", version: "0.0.1" },
        },
      }) + "\n");
    });
  } else if (msg.method === "session/new") {
    setImmediate(() => {
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          sessionId: "mock-session-1",
          modes: {
            currentModeId: "code",
            availableModes: [{ id: "code", name: "Code" }],
          },
        },
      }) + "\n");
    });
  } else if (msg.method === "session/load") {
    setImmediate(() => {
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          sessionId: msg.params.sessionId,
          modes: {
            currentModeId: "code",
            availableModes: [{ id: "code", name: "Code" }],
          },
        },
      }) + "\n");
    });
  } else if (msg.method === "session/prompt") {
    setImmediate(() => {
      // Chunk notification
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "mock-session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello from mock agent!" },
          },
        },
      }) + "\n");

      // Completed notification
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "mock-session-1",
          update: { sessionUpdate: "completed" },
        },
      }) + "\n");

      // Request response
      stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { ok: true },
      }) + "\n");
    });
  }
}

/**
 * Creates a mock child process that simulates the ACP protocol.
 */
function createMockAgentProcess(): ChildProcess {
  const mockStdout = new PassThrough();
  const mockStderr = new PassThrough();

  let stdinBuffer = "";
  const mockStdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      stdinBuffer += chunk.toString();
      const lines = stdinBuffer.split("\n");
      stdinBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleMockMessage(JSON.parse(line), mockStdout);
        } catch {
          // skip malformed lines
        }
      }
      callback();
    },
  });

  const proc = Object.assign(new EventEmitter(), {
    stdin: mockStdin,
    stdout: mockStdout,
    stderr: mockStderr,
    pid: 99999,
    connected: true,
    exitCode: null,
    signalCode: null,
    killed: false,
    spawnargs: [],
    spawnfile: "",
    kill: vi.fn(() => {
      (proc as any).killed = true;
      proc.emit("close", 0, null);
      return true;
    }),
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    stdio: [mockStdin, mockStdout, mockStderr, null, null] as any,
    [Symbol.dispose]: () => {},
  }) as unknown as ChildProcess;

  return proc;
}

/**
 * Build the full Hono app wired up exactly like index.ts,
 * but using a mock agent process instead of spawning a real one.
 */
function createTestApp() {
  const serverToken = generateToken();
  const agentManager = new AgentManager();
  const store = new Store(DB_PATH);
  store.normalizeSessionsOnStartup();
  const connectionManager = new ConnectionManager();
  const sessionManager = new SessionManager();

  agentManager.register({
    id: "test-agent",
    name: "Test Agent",
    command: "echo",
    args: [],
  });

  function buildSnapshots(sessionId?: string) {
    return store
      .listSessions()
      .filter((s) => s.status === "active")
      .filter((s) => !sessionId || s.sessionId === sessionId)
      .map((s) => ({
        type: "session:snapshot" as const,
        sessionId: s.sessionId,
        history: store.getHistory(s.sessionId),
        eventId: String(connectionManager.getCurrentEventId()),
      }));
  }

  function emitSessionError(sessionId: string, code: string, message: string) {
    connectionManager.broadcastToSession(sessionId, {
      type: "error",
      code,
      message,
    });
  }

  async function handlePrompt(
    sessionId: string,
    prompt: Array<{ type: string; text: string }>,
  ) {
    const session = store.getSession(sessionId);
    if (!session) {
      emitSessionError(sessionId, "session_not_found", "Session not found");
      return;
    }

    if (session.status === "closed") {
      emitSessionError(sessionId, "session_closed", "Session is closed");
      return;
    }

    let bridge = sessionManager.getBridge(sessionId);
    if (!bridge && session.status === "suspended" && session.recoverable) {
      bridge = await sessionManager.restoreSession(sessionId, store) ?? undefined;
    }

    if (!bridge) {
      emitSessionError(sessionId, "session_unavailable", "Session is unavailable");
      return;
    }

    for (const item of prompt) {
      if (item.type === "text") {
        store.appendHistory(sessionId, "user", item.text);
      }
    }

    store.touchSession(sessionId);
    sessionManager.markPromptStarted(sessionId);
    bridge.sendPrompt(sessionId, prompt);
  }

  function handlePermissionResponse(
    sessionId: string,
    toolCallId: string,
    outcome: { outcome: string; optionId?: string },
  ) {
    const bridge = sessionManager.getBridge(sessionId);
    if (bridge) {
      bridge.respondPermission(toolCallId, outcome);
    }
  }

  async function createBridge(
    sessionId: string,
    agentId: string,
    cwd: string,
    restoreAgentSessionId?: string | null,
  ) {
    void agentId;
    const mockProcess = createMockAgentProcess();

    const bridge = new AcpBridge(mockProcess as any, {
      onSessionUpdate(_sid, update) {
        connectionManager.broadcastToSession(sessionId, {
          type: "session:update",
          sessionId,
          update,
          eventId: "",
        });
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = (update as any).content;
          if (content?.text) {
            store.appendHistory(sessionId, "agent", content.text);
          }
        }
        if (update.sessionUpdate === "completed") {
          sessionManager.markPromptCompleted(sessionId);
          store.touchSession(sessionId);
        }
      },
      onPermissionRequest(_sid, request) {
        connectionManager.broadcastToSession(sessionId, {
          type: "session:update",
          sessionId,
          update: {
            sessionUpdate: "permission_request",
            toolCallId: (request.params as any).toolCall.toolCallId,
            toolCall: (request.params as any).toolCall,
            options: (request.params as any).options,
          } as any,
          eventId: "",
        });
      },
      onError() {},
      onClose() {
        sessionManager.handleAgentClose(sessionId, store, connectionManager);
      },
    });

    await bridge.initialize({ name: "matrix-test", version: "0.1.0" });
    const sessionResult: any = restoreAgentSessionId
      ? await bridge.loadSession(restoreAgentSessionId, cwd)
      : await bridge.createSession(cwd);

    return {
      bridge,
      modes: sessionResult.modes || {
        currentModeId: "code",
        availableModes: [{ id: "code", name: "Code" }],
      },
      recoverable: Boolean(bridge.capabilities?.loadSession),
      agentSessionId: bridge.agentSessionId,
    };
  }

  sessionManager.setBridgeFactory(createBridge);

  const app = new Hono();
  app.use("/*", cors());
  app.use("/agents/*", authMiddleware(serverToken));
  app.use("/sessions/*", authMiddleware(serverToken));

  app.route("/", createRestRoutes({
    agentManager,
    store,
    sessionManager,
    worktreeManager: new WorktreeManager(),
    createSessionForWorktree: async () => ({ sessionId: "sess_test", modes: { currentModeId: "code", availableModes: [] } }),
  }));
  app.route(
    "/",
    createTransportRoutes({
      connectionManager,
      serverToken,
      snapshotProvider: buildSnapshots,
      onPrompt: handlePrompt,
      onCancel: () => {},
      onPermissionResponse: handlePermissionResponse,
    }),
  );

  // Session creation endpoint (mirrors index.ts but uses mock process)
  app.post("/sessions", async (c) => {
    const body = await c.req.json<{ agentId: string; cwd: string }>();
    const sessionId = `sess_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { bridge, modes, recoverable, agentSessionId } = await createBridge(
      sessionId,
      body.agentId,
      body.cwd,
    );

    sessionManager.register(sessionId, bridge, body.agentId, body.cwd);
    store.createSession(sessionId, body.agentId, body.cwd, {
      recoverable,
      agentSessionId,
    });

    return c.json({
      sessionId,
      modes,
    });
  });

  return {
    app,
    serverToken,
    store,
    connectionManager,
    sessionManager,
    cleanup() {
      store.close();
      try { unlinkSync(DB_PATH); } catch {}
      try { unlinkSync(DB_PATH + "-wal"); } catch {}
      try { unlinkSync(DB_PATH + "-shm"); } catch {}
    },
  };
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

/** Helper: create a session via the test app and return the sessionId */
async function createSession(ctx: ReturnType<typeof createTestApp>, cwd = "/tmp") {
  const res = await ctx.app.request("/sessions", {
    method: "POST",
    headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ agentId: "test-agent", cwd }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.sessionId as string;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("E2E Integration Tests", () => {
  let ctx: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    try { unlinkSync(DB_PATH); } catch {}
    try { unlinkSync(DB_PATH + "-wal"); } catch {}
    try { unlinkSync(DB_PATH + "-shm"); } catch {}
    ctx = createTestApp();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ─── 1. REST API Auth ─────────────────────────────────────────────────────

  describe("REST API auth", () => {
    it("GET /agents without token returns 401", async () => {
      const res = await ctx.app.request("/agents");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Authorization");
    });

    it("GET /agents with valid token returns 200 and agent list", async () => {
      const res = await ctx.app.request("/agents", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe("test-agent");
      expect(body[0].name).toBe("Test Agent");
    });

    it("GET /agents with wrong token returns 401", async () => {
      const res = await ctx.app.request("/agents", {
        headers: authHeaders("wrong-token-value"),
      });
      expect(res.status).toBe(401);
    });

    it("POST /sessions without token returns 401", async () => {
      const res = await ctx.app.request("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "test-agent", cwd: "/tmp" }),
      });
      expect(res.status).toBe(401);
    });

    it("POST /sessions with valid token creates a session", async () => {
      const sessionId = await createSession(ctx);
      expect(sessionId).toMatch(/^sess_e2e_/);

      const stored = ctx.store.getSession(sessionId);
      expect(stored).not.toBeNull();
      expect(stored?.recoverable).toBe(true);
      expect(stored?.agentSessionId).toBe("mock-session-1");
      expect(stored?.status).toBe("active");
      expect(stored?.lastActiveAt).toBeDefined();
      expect(stored?.suspendedAt).toBeNull();
      expect(stored?.closeReason).toBeNull();
    });
  });

  // ─── 2. WebSocket subscription via ConnectionManager ──────────────────────

  describe("WebSocket subscription flow", () => {
    it("subscribes to a session and receives broadcast messages", async () => {
      const sessionId = await createSession(ctx);

      const received: any[] = [];
      const mockWs = { send: (data: string) => received.push(JSON.parse(data)) };

      ctx.connectionManager.addConnection("test-conn-1", mockWs);
      ctx.connectionManager.subscribeToSession("test-conn-1", sessionId);

      ctx.connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "test broadcast" },
        } as any,
        eventId: "",
      });

      expect(received.length).toBe(1);
      expect(received[0].type).toBe("session:update");
      expect(received[0].sessionId).toBe(sessionId);

      ctx.connectionManager.removeConnection("test-conn-1");
    });

    it("does not receive messages for unsubscribed sessions", () => {
      const received: any[] = [];
      const mockWs = { send: (data: string) => received.push(JSON.parse(data)) };

      ctx.connectionManager.addConnection("conn-2", mockWs);
      ctx.connectionManager.subscribeToSession("conn-2", "other-session");

      ctx.connectionManager.broadcastToSession("sess_xyz", {
        type: "session:update",
        sessionId: "sess_xyz",
        update: { sessionUpdate: "completed" } as any,
        eventId: "",
      });

      expect(received.length).toBe(0);
      ctx.connectionManager.removeConnection("conn-2");
    });

    it("replays missed messages after reconnect", async () => {
      const sessionId = await createSession(ctx);

      // Broadcast 3 events while nobody is connected
      for (let i = 0; i < 3; i++) {
        ctx.connectionManager.broadcastToSession(sessionId, {
          type: "session:update",
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `msg-${i}` },
          } as any,
          eventId: "",
        });
      }

      // Now a client connects and asks to replay from event 0
      const received: any[] = [];
      const mockWs = { send: (data: string) => received.push(JSON.parse(data)) };
      ctx.connectionManager.addConnection("replay-conn", mockWs);
      ctx.connectionManager.subscribeToSession("replay-conn", sessionId);

      const replayed = ctx.connectionManager.replayMissed("replay-conn", sessionId, 0);
      expect(replayed).toBe(true);
      expect(received.length).toBe(3);

      ctx.connectionManager.removeConnection("replay-conn");
    });
  });

  // ─── 3. Session Lifecycle via REST ────────────────────────────────────────

  describe("Session lifecycle", () => {
    it("full session CRUD lifecycle", async () => {
      // Create
      const sessionId = await createSession(ctx);

      // List
      const listRes = await ctx.app.request("/sessions", {
        headers: authHeaders(ctx.serverToken),
      });
      const sessions = await listRes.json();
      const found = sessions.find((s: any) => s.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found.status).toBe("active");
      expect(found.agentId).toBe("test-agent");
      expect(found.recoverable).toBe(true);
      expect(found.agentSessionId).toBe("mock-session-1");
      expect(found.lastActiveAt).toBeTruthy();
      expect(found.suspendedAt).toBeNull();
      expect(found.closeReason).toBeNull();

      // History (empty)
      const histRes = await ctx.app.request(`/sessions/${sessionId}/history`, {
        headers: authHeaders(ctx.serverToken),
      });
      expect(histRes.status).toBe(200);
      expect(await histRes.json()).toEqual([]);

      // Delete
      const deleteRes = await ctx.app.request(`/sessions/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders(ctx.serverToken),
      });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).ok).toBe(true);

      // Verify deleted
      const listRes2 = await ctx.app.request("/sessions", {
        headers: authHeaders(ctx.serverToken),
      });
      const sessions2 = await listRes2.json();
      const deleted = sessions2.find((s: any) => s.sessionId === sessionId);
      expect(deleted).toBeUndefined();
    });

    it("GET /sessions/:id/history returns 404 for unknown session", async () => {
      const res = await ctx.app.request("/sessions/nonexistent/history", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(res.status).toBe(404);
    });

    it("creating multiple sessions lists them all", async () => {
      const sid1 = await createSession(ctx, "/tmp");
      const sid2 = await createSession(ctx, "/home");

      const listRes = await ctx.app.request("/sessions", {
        headers: authHeaders(ctx.serverToken),
      });
      const ids = (await listRes.json()).map((s: any) => s.sessionId);
      expect(ids).toContain(sid1);
      expect(ids).toContain(sid2);
    });

    it("startup normalization suspends recoverable sessions and closes non-recoverable sessions", async () => {
      ctx.cleanup();

      const preRestartStore = new Store(DB_PATH);
      preRestartStore.createSession("sess_recoverable", "test-agent", "/tmp/recoverable", {
        recoverable: true,
        agentSessionId: "agent-recoverable",
      });
      preRestartStore.createSession("sess_unrecoverable", "test-agent", "/tmp/unrecoverable");
      preRestartStore.appendHistory("sess_recoverable", "user", "recoverable history");
      preRestartStore.appendHistory("sess_unrecoverable", "agent", "unrecoverable history");
      preRestartStore.close();

      ctx = createTestApp();

      const listRes = await ctx.app.request("/sessions", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(listRes.status).toBe(200);
      const sessions = await listRes.json();

      const recoverable = sessions.find((s: any) => s.sessionId === "sess_recoverable");
      expect(recoverable).toBeDefined();
      expect(recoverable.status).toBe("suspended");
      expect(recoverable.closeReason).toBeNull();

      const unrecoverable = sessions.find((s: any) => s.sessionId === "sess_unrecoverable");
      expect(unrecoverable).toBeDefined();
      expect(unrecoverable.status).toBe("closed");
      expect(unrecoverable.closeReason).toBe("server_restart_unrecoverable");

      const recoverableHistoryRes = await ctx.app.request("/sessions/sess_recoverable/history", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(recoverableHistoryRes.status).toBe(200);
      const recoverableHistory = await recoverableHistoryRes.json();
      expect(recoverableHistory).toHaveLength(1);
      expect(recoverableHistory[0].content).toBe("recoverable history");

      const unrecoverableHistoryRes = await ctx.app.request("/sessions/sess_unrecoverable/history", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(unrecoverableHistoryRes.status).toBe(200);
      const unrecoverableHistory = await unrecoverableHistoryRes.json();
      expect(unrecoverableHistory).toHaveLength(1);
      expect(unrecoverableHistory[0].content).toBe("unrecoverable history");
    });
  });

  // ─── 4. HTTP Transport Endpoints ──────────────────────────────────────────

  describe("HTTP transport endpoints", () => {
    it("GET /poll returns empty events when nothing happened", async () => {
      const res = await ctx.app.request("/poll", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("GET /poll returns events after broadcasts", async () => {
      const sessionId = await createSession(ctx);

      ctx.connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "chunk1" },
        } as any,
        eventId: "",
      });

      const res = await ctx.app.request("/poll?lastEventId=0", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].type).toBe("session:update");
    });

    it("GET /poll without token returns 401", async () => {
      const res = await ctx.app.request("/poll");
      expect(res.status).toBe(401);
    });

    it("POST /messages without token returns 401", async () => {
      const res = await ctx.app.request("/messages", {
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

    it("POST /messages with valid token accepts client messages", async () => {
      const res = await ctx.app.request("/messages", {
        method: "POST",
        headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "session:prompt",
          sessionId: "sess_1",
          prompt: [{ type: "text", text: "hello" }],
        }),
      });
      expect(res.status).toBe(202);
      expect((await res.json()).ok).toBe(true);
    });

    it("POST /messages triggers onPrompt callback for real session", async () => {
      const sessionId = await createSession(ctx);

      const msgRes = await ctx.app.request("/messages", {
        method: "POST",
        headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "session:prompt",
          sessionId,
          prompt: [{ type: "text", text: "What is 2+2?" }],
        }),
      });
      expect(msgRes.status).toBe(202);

      // Give mock agent time to process the async response
      await new Promise((r) => setTimeout(r, 50));

      const histRes = await ctx.app.request(`/sessions/${sessionId}/history`, {
        headers: authHeaders(ctx.serverToken),
      });
      const history = await histRes.json();

      const userEntry = history.find(
        (h: any) => h.role === "user" && h.content === "What is 2+2?",
      );
      expect(userEntry).toBeDefined();

      const agentEntry = history.find(
        (h: any) => h.role === "agent" && h.content === "Hello from mock agent!",
      );
      expect(agentEntry).toBeDefined();
    });

    it("POST /messages restores a suspended recoverable session before forwarding the prompt", async () => {
      ctx.store.createSession("sess_suspended", "test-agent", "/tmp/suspended", {
        recoverable: true,
        agentSessionId: "agent-suspended-1",
      });
      ctx.store.updateSessionState("sess_suspended", {
        status: "suspended",
        suspendedAt: "2026-03-14T12:00:00.000Z",
      });

      const msgRes = await ctx.app.request("/messages", {
        method: "POST",
        headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "session:prompt",
          sessionId: "sess_suspended",
          prompt: [{ type: "text", text: "resume me" }],
        }),
      });
      expect(msgRes.status).toBe(202);

      await new Promise((r) => setTimeout(r, 50));

      const session = ctx.store.getSession("sess_suspended");
      expect(session?.status).toBe("active");
      expect(session?.suspendedAt).toBeNull();

      const history = ctx.store.getHistory("sess_suspended");
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "resume me" }),
          expect.objectContaining({ role: "agent", content: "Hello from mock agent!" }),
        ]),
      );
      expect(ctx.sessionManager.getBridge("sess_suspended")).toBeDefined();
    });

    it("POST /messages emits an explicit error for a deleted session", async () => {
      const sessionId = await createSession(ctx);
      await ctx.app.request(`/sessions/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders(ctx.serverToken),
      });

      const msgRes = await ctx.app.request("/messages", {
        method: "POST",
        headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "session:prompt",
          sessionId,
          prompt: [{ type: "text", text: "can you still answer?" }],
        }),
      });
      expect(msgRes.status).toBe(202);

      const pollRes = await ctx.app.request("/poll?lastEventId=0", {
        headers: authHeaders(ctx.serverToken),
      });
      expect(pollRes.status).toBe(200);
      const events = await pollRes.json();
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "error",
            code: "session_not_found",
            message: "Session not found",
          }),
        ]),
      );
    });
  });

  // ─── 5. Full prompt round-trip ────────────────────────────────────────────

  describe("Full prompt round-trip", () => {
    it("creates session, sends prompt, receives agent response via subscription and history", async () => {
      const sessionId = await createSession(ctx);

      // Subscribe to receive broadcast events
      const received: any[] = [];
      const mockWs = { send: (data: string) => received.push(JSON.parse(data)) };
      ctx.connectionManager.addConnection("e2e-conn", mockWs);
      ctx.connectionManager.subscribeToSession("e2e-conn", sessionId);

      // Send a prompt
      const promptRes = await ctx.app.request("/messages", {
        method: "POST",
        headers: authHeaders(ctx.serverToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "session:prompt",
          sessionId,
          prompt: [{ type: "text", text: "Tell me a joke" }],
        }),
      });
      expect(promptRes.status).toBe(202);

      // Wait for mock agent to process
      await new Promise((r) => setTimeout(r, 100));

      // Should have received broadcast events (chunk + completed)
      expect(received.length).toBeGreaterThanOrEqual(1);
      const chunkMsg = received.find(
        (m) => m.type === "session:update" && m.update?.sessionUpdate === "agent_message_chunk",
      );
      expect(chunkMsg).toBeDefined();
      expect(chunkMsg.update.content.text).toBe("Hello from mock agent!");

      // Verify history
      const histRes = await ctx.app.request(`/sessions/${sessionId}/history`, {
        headers: authHeaders(ctx.serverToken),
      });
      const history = await histRes.json();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.map((h: any) => h.role)).toContain("user");
      expect(history.map((h: any) => h.role)).toContain("agent");

      // Poll should also have events
      const pollRes = await ctx.app.request("/poll?lastEventId=0", {
        headers: authHeaders(ctx.serverToken),
      });
      expect((await pollRes.json()).length).toBeGreaterThanOrEqual(1);

      ctx.connectionManager.removeConnection("e2e-conn");
    });

    it("deleting a session prevents further prompts from being processed", async () => {
      const sessionId = await createSession(ctx);

      await ctx.app.request(`/sessions/${sessionId}`, {
        method: "DELETE",
        headers: authHeaders(ctx.serverToken),
      });

      expect(ctx.sessionManager.getBridge(sessionId)).toBeUndefined();

      const listRes = await ctx.app.request("/sessions", {
        headers: authHeaders(ctx.serverToken),
      });
      const session = (await listRes.json()).find((s: any) => s.sessionId === sessionId);
      expect(session).toBeUndefined();
    });
  });

  // ─── 6. SSE endpoint auth ────────────────────────────────────────────────

  describe("SSE endpoint", () => {
    it("GET /sse without token returns 401", async () => {
      const res = await ctx.app.request("/sse");
      expect(res.status).toBe(401);
    });

    it("GET /sse with invalid token returns 401", async () => {
      const res = await ctx.app.request("/sse?token=bad-token");
      expect(res.status).toBe(401);
    });
  });
});
