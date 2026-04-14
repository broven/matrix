import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import path from "node:path";
import { loadConfig } from "./config.js";
import { generateToken, maskToken } from "./auth/token.js";
import { getPersistedToken } from "./persistent-config.js";
import { authMiddleware } from "./auth/middleware.js";
import { AgentManager } from "./agent-manager/index.js";
import { discoverAgents } from "./agent-manager/discovery.js";
import { Store } from "./store/index.js";
import { AcpBridge } from "./acp-bridge/index.js";
import { createRestRoutes } from "./api/rest/index.js";
import { createWebSocketInstance, setupWebSocket } from "./api/ws/index.js";
import { ConnectionManager } from "./api/ws/connection-manager.js";
import { setupBridge, ClientRegistry } from "./bridge/index.js";
import { createTransportRoutes } from "./api/transport/index.js";
import { SessionManager } from "./session-manager/index.js";
import { WorktreeManager } from "./worktree-manager/index.js";
import { CloneManager } from "./clone-manager/index.js";
import { CommandCache } from "./command-cache.js";
import { getServerConfig } from "./api/rest/server-config.js";
import type { AgentCapabilities, CreateSessionRequest, SessionInfo, PromptContent } from "@matrix/protocol";
import { nanoid } from "nanoid";
import qrcode from "qrcode-terminal";
import { buildConnectionUri, getLocalIp } from "./connect-info.js";

import { validateDataDir } from "./data-dir.js";
import { logger } from "./logger.js";

const log = logger.child({ target: "server" });

const config = loadConfig();
validateDataDir();
const serverToken = process.env.MATRIX_TOKEN || getPersistedToken();
const agentManager = new AgentManager();
const store = new Store(config.dbPath);
store.normalizeSessionsOnStartup();
const connectionManager = new ConnectionManager();
const sessionManager = new SessionManager();
const worktreeManager = new WorktreeManager();
const cloneManager = new CloneManager();
const commandCache = new CommandCache();
const clientRegistry = new ClientRegistry();
const IDLE_SUSPEND_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_SUSPEND_SWEEP_INTERVAL_MS = 60 * 1000;

/** Per-session buffer for aggregating agent_message_chunk text */
const agentMessageBuffers = new Map<string, string>();

/** Deduplication map for in-flight lazy agent initialization */
const pendingLazyInits = new Map<string, Promise<AcpBridge>>();

function flushAgentMessageBuffer(sessionId: string): void {
  const buffered = agentMessageBuffers.get(sessionId);
  if (buffered) {
    store.appendHistory(sessionId, "agent", buffered, "text");
    agentMessageBuffers.delete(sessionId);
  }
}

// Discover and register ACP agents
const discoveredAgents = await discoverAgents();
for (const agent of discoveredAgents) {
  agentManager.register(agent, "builtin");
}

// Merge custom agents and profiles from store
function refreshAgentConfigs(): void {
  agentManager.mergeCustomConfigs(
    store.listCustomAgents(),
    store.listAgentEnvProfiles(),
  );
}
refreshAgentConfigs();

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

async function handlePrompt(sessionId: string, prompt: PromptContent[]) {
  log.info({ sessionId, prompt: JSON.stringify(prompt).slice(0, 200) }, "handlePrompt");
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

  // Lazy agent initialization: spawn agent on first prompt
  if (!bridge && !session.agentId) {
    const firstText = prompt.find((p): p is Extract<PromptContent, { type: "text" }> => p.type === "text");
    const agentId = firstText?.agentId;
    const profileId = firstText?.profileId ?? null;
    if (!agentId) {
      emitSessionError(sessionId, "agent_required", "No agent selected. Please select an agent before sending a message.");
      return;
    }

    // Validate that the agent exists before attempting to spawn
    if (!agentManager.getConfig(agentId)) {
      emitSessionError(sessionId, "agent_not_found", `Agent "${agentId}" not found`);
      return;
    }

    // Deduplicate concurrent lazy init attempts for the same session
    let initPromise = pendingLazyInits.get(sessionId);
    if (!initPromise) {
      initPromise = (async () => {
        const result = await createBridge(sessionId, agentId, session.cwd, undefined, profileId ?? undefined);
        sessionManager.register(sessionId, result.bridge, agentId, session.cwd);
        store.updateSessionState(sessionId, {
          agentId,
          profileId,
          recoverable: result.recoverable,
          agentSessionId: result.agentSessionId,
        });
        return result.bridge;
      })();
      pendingLazyInits.set(sessionId, initPromise);
    }

    try {
      bridge = await initPromise;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to spawn agent";
      emitSessionError(sessionId, "agent_spawn_failed", message);
      return;
    } finally {
      pendingLazyInits.delete(sessionId);
    }
  }

  // Restore idle agent (bridge was killed to reclaim resources)
  if (!bridge && session.agentId) {
    if (session.recoverable && session.agentSessionId) {
      connectionManager.broadcastToSession(sessionId, {
        type: "session:restoring",
        sessionId,
      } as any);
      bridge = await sessionManager.restoreSession(sessionId, store) ?? undefined;
    }
    // If not recoverable or restore failed, spawn a fresh agent
    if (!bridge) {
      try {
        const result = await createBridge(sessionId, session.agentId, session.cwd, undefined, session.profileId ?? undefined);
        bridge = result.bridge;
        sessionManager.register(sessionId, bridge, session.agentId, session.cwd);
        store.updateSessionState(sessionId, {
          recoverable: result.recoverable,
          agentSessionId: result.agentSessionId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to spawn agent";
        emitSessionError(sessionId, "agent_spawn_failed", message);
        return;
      }
    }
  }

  if (!bridge) {
    emitSessionError(sessionId, "session_unavailable", "Session is unavailable");
    return;
  }

  // Check if prompt contains images and agent supports them
  const hasImages = prompt.some((item) => item.type === "image");
  if (hasImages && !bridge.capabilities?.promptCapabilities?.image) {
    emitSessionError(sessionId, "unsupported_content", "This agent does not support image input");
    return;
  }

  // Build a combined user message text including any file mentions
  const textParts: string[] = [];
  let imageCount = 0;
  for (const item of prompt) {
    if (item.type === "text") {
      textParts.push(item.text);
    } else if (item.type === "resource_link") {
      textParts.push(`@${item.name}`);
    } else if (item.type === "image") {
      imageCount++;
    }
  }
  if (imageCount > 0) {
    textParts.push(` [${imageCount} image${imageCount > 1 ? "s" : ""}]`);
  }
  if (textParts.length > 0) {
    store.appendHistory(sessionId, "user", textParts.join(""));
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

function validateCapabilities(caps: AgentCapabilities | null): string[] {
  // No hard requirements for now — all mainstream agents should work.
  // Add checks here as needed, e.g.:
  // if (!caps?.promptCapabilities?.embeddedContext) missing.push("embeddedContext");
  return [];
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
  profileId?: string,
): Promise<{
  bridge: AcpBridge;
  modes: { currentModeId: string; availableModes: unknown[] };
  recoverable: boolean;
  agentSessionId: string | null;
}> {
  const handle = agentManager.spawn(agentId, cwd, profileId);

  const bridge = new AcpBridge(handle.process, {
    onSessionUpdate(sid, update) {
      log.debug({ sessionId, update: update.sessionUpdate }, "session update");
      store.touchSession(sessionId);
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update,
        eventId: "",
      });

      // Cache available commands per worktree+agent
      if (update.sessionUpdate === "available_commands_update") {
        const sess = store.getSession(sessionId);
        if (sess?.worktreeId && sess.agentId) {
          commandCache.set(sess.worktreeId, sess.agentId, update.availableCommands);
        }
      }

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
      log.info({ sessionId }, "permission_request");
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
      log.error({ sessionId, err: error }, "agent error");
      connectionManager.broadcastToSession(sessionId, {
        type: "error",
        code: "agent_error",
        message: error.message,
      });
    },
    onClose() {
      log.info({ sessionId }, "agent process closed");
      // Flush any buffered agent message chunks before closing
      flushAgentMessageBuffer(sessionId);
      sessionManager.handleAgentClose(sessionId, store, connectionManager);
    },
  });

  await bridge.initialize({ name: "matrix-server", version: "0.1.0" });

  // Validate agent capabilities
  const missing = validateCapabilities(bridge.capabilities);
  if (missing.length > 0) {
    bridge.destroy();
    throw new Error(`Agent "${agentId}" missing required capabilities: ${missing.join(", ")}`);
  }

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

/**
 * Push cached commands to a newly created session so the client gets them
 * before the agent sends its first available_commands_update.
 */
function pushCachedCommands(sessionId: string, worktreeId: string | undefined, agentId: string): void {
  if (!worktreeId) return;
  const cached = commandCache.get(worktreeId, agentId);
  if (cached) {
    connectionManager.broadcastToSession(sessionId, {
      type: "session:update",
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: cached,
      },
      eventId: "",
    });
  }
}

const app = new Hono();

// CORS for web client — allow any origin since access is gated by bearer token
app.use("/*", cors({
  origin: (origin) => origin || "*",
  allowHeaders: ["X-Matrix-Internal", "Authorization", "Content-Type"],
}));

// Auth middleware for REST (WebSocket handles auth separately)
app.use("/agents", authMiddleware(serverToken));
app.use("/agents/*", authMiddleware(serverToken));
app.use("/sessions", authMiddleware(serverToken));
app.use("/sessions/*", authMiddleware(serverToken));
app.use("/repositories", authMiddleware(serverToken));
app.use("/repositories/*", authMiddleware(serverToken));
app.use("/worktrees", authMiddleware(serverToken));
app.use("/worktrees/*", authMiddleware(serverToken));
app.use("/fs/*", authMiddleware(serverToken));
app.use("/server/*", authMiddleware(serverToken));
app.use("/custom-agents", authMiddleware(serverToken));
app.use("/custom-agents/*", authMiddleware(serverToken));
app.use("/agent-profiles", authMiddleware(serverToken));
app.use("/agent-profiles/*", authMiddleware(serverToken));
// Note: /bridge/* auth is handled inside setupBridge (WebSocket uses query param auth)

export function isLoopbackRequest(c: any): boolean {
  const addr: string | undefined = c.env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;
  const isLoopbackIp = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!isLoopbackIp) return false;

  // Require internal header to prevent CSRF from browsers on same machine
  return c.req.header("X-Matrix-Internal") === "true";
}

// Ping endpoint — auth-protected, externally accessible, for connection testing
app.get("/api/ping", authMiddleware(serverToken), (c) => {
  return c.json({ ok: true });
});

// Specialized middleware to block non-local origins for sensitive loopback endpoints (Localhost CSRF protection)
export const localOriginMiddleware = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin) {
    const isLocalOrigin =
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://[::1]:");
    if (!isLocalOrigin) {
      log.warn({ origin, path: c.req.path }, "blocked non-local origin request to sensitive loopback endpoint");
      return c.json({ error: "Forbidden: Cross-origin request blocked" }, 403);
    }
  }
  await next();
});

// Auth info endpoint — loopback only, lets desktop app fetch its token
app.get("/api/auth-info", localOriginMiddleware, (c) => {
  if (!isLoopbackRequest(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json({ token: serverToken });
});

// Local IP endpoint — loopback only, for sidecar QR code generation
app.get("/api/local-ip", localOriginMiddleware, (c) => {
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
app.route("/", createRestRoutes({
  agentManager,
  store,
  sessionManager,
  worktreeManager,
  cloneManager,
  connectionManager,
  onAgentConfigChange: refreshAgentConfigs,
  localMode: config.localMode,
}));
app.route("/", createTransportRoutes({
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onCancel: handleCancel,
  onPermissionResponse: handlePermissionResponse,
}));

// Session creation (lazy — no agent spawned)
app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();

  // Resolve cwd: from worktreeId or direct cwd
  let cwd = body.cwd;
  let worktreeId: string | undefined;

  if (body.worktreeId) {
    const worktree = store.getWorktree(body.worktreeId);
    if (!worktree) {
      return c.json({ error: "Worktree not found" }, 404);
    }
    cwd = worktree.path;
    worktreeId = body.worktreeId;
  }

  if (!cwd) {
    return c.json({ error: "cwd or worktreeId is required" }, 400);
  }

  const sessionId = `sess_${nanoid()}`;
  store.createSession(sessionId, null, cwd, { worktreeId });

  const sessionInfo = store.listSessions().find(s => s.sessionId === sessionId);
  if (sessionInfo) {
    connectionManager.broadcastToAll({ type: "server:session_created", session: sessionInfo });
  }

  return c.json({ sessionId });
});

// Shared WebSocket instance — both /ws and /bridge use the same upgrade handler
const { injectWebSocket, upgradeWebSocket } = createWebSocketInstance(app as any);

// WebSocket setup for session communication (/ws)
setupWebSocket(app as any, {
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onCancel: handleCancel,
  onPermissionResponse: handlePermissionResponse,
  onSubscribe: (sessionId: string) => {
    const sess = store.getSession(sessionId);
    if (!sess?.worktreeId) return;
    // Use session's agentId, or fall back to server's defaultAgent config
    const agentId = sess.agentId || getServerConfig().defaultAgent;
    if (agentId) {
      pushCachedCommands(sessionId, sess.worktreeId, agentId);
    }

    // Auto-resume suspended agent so slash commands are available without sending a message
    if (sess.agentId && !sessionManager.getBridge(sessionId)) {
      void (async () => {
        connectionManager.broadcastToSession(sessionId, {
          type: "session:restoring",
          sessionId,
        } as any);
        let bridge: ReturnType<typeof sessionManager.getBridge> | undefined;
        if (sess.recoverable && sess.agentSessionId) {
          bridge = await sessionManager.restoreSession(sessionId, store) ?? undefined;
        }
        if (!bridge) {
          try {
            const result = await createBridge(sessionId, sess.agentId!, sess.cwd, undefined, sess.profileId ?? undefined);
            sessionManager.register(sessionId, result.bridge, sess.agentId!, sess.cwd);
            store.updateSessionState(sessionId, {
              recoverable: result.recoverable,
              agentSessionId: result.agentSessionId,
            });
          } catch {
            // Silent fail — user can still send a prompt to retry
          }
        }
      })();
    }
  },
}, upgradeWebSocket);

// Automation bridge setup (/bridge WebSocket + /bridge/* HTTP routes)
setupBridge(app as any, { serverToken, clientRegistry, upgradeWebSocket });

// Serve static web UI files if configured
if (config.webDir) {
  const resolvedWebDir = path.resolve(config.webDir);

  // Serve static assets (exclude API and WebSocket paths)
  app.get("/*", async (c, next) => {
    const p = c.req.path;
    // Skip API routes and WebSocket endpoint
    if (p === "/ws" || p.startsWith("/api/") || p.startsWith("/agents") || p.startsWith("/sessions") || p.startsWith("/repositories") || p.startsWith("/worktrees") || p.startsWith("/fs/") || p.startsWith("/server/") || p.startsWith("/poll") || p.startsWith("/sse") || p.startsWith("/messages") || p.startsWith("/custom-agents") || p.startsWith("/agent-profiles") || p.startsWith("/bridge")) {
      return next();
    }
    const res = await serveStatic({ root: resolvedWebDir })(c, next);
    return res;
  });

  // SPA fallback: serve index.html for non-API GET requests
  app.get("/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/ws" || p.startsWith("/api/") || p.startsWith("/agents") || p.startsWith("/sessions") || p.startsWith("/repositories") || p.startsWith("/worktrees") || p.startsWith("/fs/") || p.startsWith("/server/") || p.startsWith("/poll") || p.startsWith("/sse") || p.startsWith("/messages") || p.startsWith("/custom-agents") || p.startsWith("/agent-profiles") || p.startsWith("/bridge")) {
      return next();
    }
    return serveStatic({ root: resolvedWebDir, path: "index.html" })(c, next);
  });

  log.info({ webDir: resolvedWebDir }, "serving web UI");
}

// Start server
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

injectWebSocket(server);

const idleSuspendSweepTimer = setInterval(() => {
  const suspendedIds = sessionManager.suspendIdleSessions(store, Date.now(), IDLE_SUSPEND_TIMEOUT_MS);
  for (const sessionId of suspendedIds) {
    connectionManager.broadcastToSession(sessionId, {
      type: "session:suspended",
      sessionId,
    } as any);
  }
}, IDLE_SUSPEND_SWEEP_INTERVAL_MS);
idleSuspendSweepTimer.unref();

log.info({
  host: config.host,
  port: config.port,
  token: maskToken(serverToken),
}, "Matrix Server started");
const advertisedHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
const connectionUri = buildConnectionUri(`http://${advertisedHost}:${config.port}`, serverToken);
log.info({ agents: discoveredAgents.map(a => a.name) }, "discovered agents");

// Startup info to stdout (not structured log) — contains secrets
console.log(`\n  Auth token: ${serverToken}`);
console.log(`\n  Connect URI: ${connectionUri}`);
console.log("\n  Scan QR:");
qrcode.generate(connectionUri, { small: true });
