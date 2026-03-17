import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import path from "node:path";
import { loadConfig } from "./config.js";
import { generateToken } from "./auth/token.js";
import { getPersistedToken } from "./persistent-config.js";
import { authMiddleware } from "./auth/middleware.js";
import { AgentManager } from "./agent-manager/index.js";
import { Store } from "./store/index.js";
import { AcpBridge } from "./acp-bridge/index.js";
import { createRestRoutes } from "./api/rest/index.js";
import { setupWebSocket } from "./api/ws/index.js";
import { ConnectionManager } from "./api/ws/connection-manager.js";
import { createTransportRoutes } from "./api/transport/index.js";
import { SessionManager } from "./session-manager/index.js";
import type { CreateSessionRequest } from "@matrix/protocol";
import { nanoid } from "nanoid";
import qrcode from "qrcode-terminal";
import { buildConnectionUri, getLocalIp } from "./connect-info.js";

const config = loadConfig();
const serverToken = process.env.MATRIX_TOKEN || getPersistedToken();
const agentManager = new AgentManager();
const store = new Store(config.dbPath);
store.normalizeSessionsOnStartup();
const connectionManager = new ConnectionManager();
const sessionManager = new SessionManager();
const IDLE_SUSPEND_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_SUSPEND_SWEEP_INTERVAL_MS = 60 * 1000;

/** Per-session buffer for aggregating agent_message_chunk text */
const agentMessageBuffers = new Map<string, string>();

function flushAgentMessageBuffer(sessionId: string): void {
  const buffered = agentMessageBuffers.get(sessionId);
  if (buffered) {
    store.appendHistory(sessionId, "agent", buffered, "text");
    agentMessageBuffers.delete(sessionId);
  }
}

// Register configured agents
for (const agent of config.agents) {
  agentManager.register(agent);
}

function buildSnapshots(sessionId?: string) {
  const sessions = store
    .listSessions()
    .filter((session) => session.status === "active")
    .filter((session) => !sessionId || session.sessionId === sessionId);

  return sessions.map((session) => ({
    type: "session:snapshot" as const,
    sessionId: session.sessionId,
    history: store.getHistory(session.sessionId),
    eventId: String(connectionManager.getCurrentEventId()),
  }));
}

function emitSessionError(sessionId: string, code: string, message: string): void {
  connectionManager.broadcastToSession(sessionId, {
    type: "error",
    code,
    message,
  });
}

async function handlePrompt(sessionId: string, prompt: Array<{ type: string; text: string }>) {
  console.log(`[session ${sessionId}] handlePrompt:`, JSON.stringify(prompt).slice(0, 200));
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

function handleCancel(sessionId: string) {
  sessionManager.cancelPrompt(sessionId);
}

function handlePermissionResponse(sessionId: string, toolCallId: string, outcome: { outcome: string; optionId?: string }) {
  const bridge = sessionManager.getBridge(sessionId);
  if (bridge) {
    bridge.respondPermission(toolCallId, outcome);
  }
}

/**
 * Creates and initializes a bridge for a session.
 * Used both for initial session creation and for auto-restart.
 */
async function createBridge(
  sessionId: string,
  agentId: string,
  cwd: string,
  restoreAgentSessionId?: string | null,
): Promise<{
  bridge: AcpBridge;
  modes: { currentModeId: string; availableModes: unknown[] };
  recoverable: boolean;
  agentSessionId: string | null;
}> {
  const handle = agentManager.spawn(agentId, cwd);

  const bridge = new AcpBridge(handle.process, {
    onSessionUpdate(sid, update) {
      console.log(`[session ${sessionId}] update: ${update.sessionUpdate}`, JSON.stringify(update).slice(0, 200));
      store.touchSession(sessionId);
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update,
        eventId: "",
      });

      // Persist structured events
      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          const existing = agentMessageBuffers.get(sessionId) ?? "";
          agentMessageBuffers.set(sessionId, existing + update.content.text);
          break;
        }
        case "tool_call":
          store.appendEvent(sessionId, "tool_call", update as unknown as Record<string, unknown>);
          break;
        case "tool_call_update":
          store.appendEvent(sessionId, "tool_call_update", update as unknown as Record<string, unknown>);
          break;
        case "plan":
          store.appendEvent(sessionId, "plan", update as unknown as Record<string, unknown>);
          break;
        case "completed":
          sessionManager.markPromptCompleted(sessionId);
          flushAgentMessageBuffer(sessionId);
          store.appendEvent(sessionId, "completed", update as unknown as Record<string, unknown>);
          break;
      }
    },
    onPermissionRequest(sid, request) {
      console.log(`[session ${sessionId}] permission_request:`, JSON.stringify(request.params).slice(0, 300));
      store.touchSession(sessionId);
      const permUpdate = {
        sessionUpdate: "permission_request" as const,
        toolCallId: (request.params as any).toolCall.toolCallId,
        toolCall: (request.params as any).toolCall,
        options: (request.params as any).options,
      };
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update: permUpdate,
        eventId: "",
      });
      store.appendEvent(sessionId, "permission_request", permUpdate as unknown as Record<string, unknown>);
    },
    onError(error) {
      console.error(`[session ${sessionId}] Agent error:`, error);
      connectionManager.broadcastToSession(sessionId, {
        type: "error",
        code: "agent_error",
        message: error.message,
      });
    },
    onClose() {
      console.log(`[session ${sessionId}] agent process closed`);
      console.log(`[session ${sessionId}] Agent process closed`);
      // Flush any buffered agent message chunks before closing
      flushAgentMessageBuffer(sessionId);
      sessionManager.handleAgentClose(sessionId, store, connectionManager);
    },
  });

  await bridge.initialize({ name: "matrix-server", version: "0.1.0" });
  const sessionResult = restoreAgentSessionId
    ? await bridge.loadSession(restoreAgentSessionId, cwd) as any
    : await bridge.createSession(cwd) as any;

  return {
    bridge,
    modes: sessionResult.modes || { currentModeId: "code", availableModes: [] },
    recoverable: Boolean(bridge.capabilities?.loadSession),
    agentSessionId: bridge.agentSessionId,
  };
}

// Register the bridge factory for auto-restart
sessionManager.setBridgeFactory(createBridge);

const app = new Hono();

// CORS for web client
if (config.localMode) {
  // Local sidecar mode: allow all origins (only accessible on loopback)
  app.use("/*", cors({ origin: (origin) => origin || "*" }));
} else {
  const corsOrigins = [
    "http://localhost:5173",  // Vite dev server
    "http://localhost:1420",  // Tauri dev
    "tauri://localhost",      // Tauri production (macOS)
    "https://tauri.localhost", // Tauri production (Windows/Linux)
  ];
  if (process.env.CLIENT_PORT) {
    corsOrigins.push(`http://localhost:${process.env.CLIENT_PORT}`);
  }
  app.use("/*", cors({ origin: corsOrigins }));
}

// Auth middleware for REST (WebSocket handles auth separately)
app.use("/agents", authMiddleware(serverToken));
app.use("/agents/*", authMiddleware(serverToken));
app.use("/sessions", authMiddleware(serverToken));
app.use("/sessions/*", authMiddleware(serverToken));

function isLoopbackRequest(c: any): boolean {
  const addr: string | undefined = c.env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// Auth info endpoint — loopback only, lets desktop app fetch its token
app.get("/api/auth-info", (c) => {
  if (!isLoopbackRequest(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json({ token: serverToken });
});

// Local IP endpoint — loopback only, for sidecar QR code generation
app.get("/api/local-ip", (c) => {
  if (!isLoopbackRequest(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const ip = getLocalIp();
  if (!ip) {
    return c.json({ error: "No LAN address found" }, 404);
  }
  return c.json({ ip });
});

// REST routes
app.route("/", createRestRoutes(agentManager, store, sessionManager));
app.route("/", createTransportRoutes({
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onCancel: handleCancel,
  onPermissionResponse: handlePermissionResponse,
}));

// Session creation (needs special handling — spawns agent)
app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();

  const sessionId = `sess_${nanoid()}`;
  try {
    const { bridge, modes, recoverable, agentSessionId } = await createBridge(sessionId, body.agentId, body.cwd);

    sessionManager.register(sessionId, bridge, body.agentId, body.cwd);
    store.createSession(sessionId, body.agentId, body.cwd, {
      recoverable,
      agentSessionId,
    });

    return c.json({ sessionId, modes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    console.error(`[session ${sessionId}] Creation failed:`, message);
    return c.json({ error: message }, 500);
  }
});

// WebSocket setup
const { injectWebSocket } = setupWebSocket(app as any, {
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onCancel: handleCancel,
  onPermissionResponse: handlePermissionResponse,
});

// Serve static web UI files if configured
if (config.webDir) {
  const resolvedWebDir = path.resolve(config.webDir);

  // Serve static assets (exclude API and WebSocket paths)
  app.get("/*", async (c, next) => {
    const p = c.req.path;
    // Skip API routes and WebSocket endpoint
    if (p === "/ws" || p.startsWith("/agents") || p.startsWith("/sessions") || p.startsWith("/poll") || p.startsWith("/sse") || p.startsWith("/messages")) {
      return next();
    }
    const res = await serveStatic({ root: resolvedWebDir })(c, next);
    return res;
  });

  // SPA fallback: serve index.html for non-API GET requests
  app.get("/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/ws" || p.startsWith("/agents") || p.startsWith("/sessions") || p.startsWith("/poll") || p.startsWith("/sse") || p.startsWith("/messages")) {
      return next();
    }
    return serveStatic({ root: resolvedWebDir, path: "index.html" })(c, next);
  });

  console.log(`  Serving web UI from ${resolvedWebDir}`);
}

// Start server
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

injectWebSocket(server);

const idleSuspendSweepTimer = setInterval(() => {
  sessionManager.suspendIdleSessions(store, Date.now(), IDLE_SUSPEND_TIMEOUT_MS);
}, IDLE_SUSPEND_SWEEP_INTERVAL_MS);
idleSuspendSweepTimer.unref();

console.log(`\n  Matrix Server running on http://${config.host}:${config.port}`);
console.log(`\n  Auth token: ${serverToken}`);
const advertisedHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
const connectionUri = buildConnectionUri(`http://${advertisedHost}:${config.port}`, serverToken);
console.log(`\n  Connect URI: ${connectionUri}`);
console.log("\n  Scan QR:");
qrcode.generate(connectionUri, { small: true });
console.log(`\n  Registered agents: ${config.agents.map((a) => a.name).join(", ")}\n`);
