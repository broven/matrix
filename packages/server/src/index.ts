import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { generateToken } from "./auth/token.js";
import { authMiddleware } from "./auth/middleware.js";
import { AgentManager } from "./agent-manager/index.js";
import { Store } from "./store/index.js";
import { AcpBridge } from "./acp-bridge/index.js";
import { createRestRoutes } from "./api/rest/index.js";
import { setupWebSocket } from "./api/ws/index.js";
import { ConnectionManager } from "./api/ws/connection-manager.js";
import { createTransportRoutes } from "./api/transport/index.js";
import type { CreateSessionRequest } from "@matrix/protocol";
import { nanoid } from "nanoid";
import qrcode from "qrcode-terminal";
import { buildConnectionUri } from "./connect-info.js";

const config = loadConfig();
const serverToken = generateToken();
const agentManager = new AgentManager();
const store = new Store(config.dbPath);
const connectionManager = new ConnectionManager();

// Register configured agents
for (const agent of config.agents) {
  agentManager.register(agent);
}

// Track active bridges per session
const bridges = new Map<string, AcpBridge>();

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

function handlePrompt(sessionId: string, prompt: Array<{ type: string; text: string }>) {
  const bridge = bridges.get(sessionId);
  if (bridge) {
    for (const item of prompt) {
      if (item.type === "text") {
        store.appendHistory(sessionId, "user", item.text);
      }
    }
    bridge.sendPrompt(sessionId, prompt);
  }
}

function handlePermissionResponse(sessionId: string, toolCallId: string, outcome: { outcome: string; optionId?: string }) {
  const bridge = bridges.get(sessionId);
  if (bridge) {
    bridge.respondPermission(toolCallId, outcome);
  }
}

const app = new Hono();

// CORS for web client
app.use("/*", cors());

// Auth middleware for REST (WebSocket handles auth separately)
app.use("/agents/*", authMiddleware(serverToken));
app.use("/sessions/*", authMiddleware(serverToken));

// REST routes
app.route("/", createRestRoutes(agentManager, store));
app.route("/", createTransportRoutes({
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onPermissionResponse: handlePermissionResponse,
}));

// Session creation (needs special handling — spawns agent)
app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();

  const handle = agentManager.spawn(body.agentId, body.cwd);
  const sessionId = `sess_${nanoid()}`;

  const bridge = new AcpBridge(handle.process, {
    onSessionUpdate(sid, update) {
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update,
        eventId: "",
      });
      // Store text messages in history
      if (update.sessionUpdate === "agent_message_chunk") {
        store.appendHistory(sessionId, "agent", update.content.text);
      }
    },
    onPermissionRequest(sid, request) {
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update: {
          sessionUpdate: "permission_request",
          toolCallId: (request.params as any).toolCall.toolCallId,
          toolCall: (request.params as any).toolCall,
          options: (request.params as any).options,
        },
        eventId: "",
      });
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
      console.log(`[session ${sessionId}] Agent process closed`);
      connectionManager.broadcastToSession(sessionId, {
        type: "session:closed",
        sessionId,
      });
      bridges.delete(sessionId);
    },
  });

  bridges.set(sessionId, bridge);

  // Initialize ACP connection
  const initResult = await bridge.initialize({ name: "matrix-server", version: "0.1.0" });
  const sessionResult = await bridge.createSession(body.cwd) as any;

  store.createSession(sessionId, body.agentId, body.cwd);

  return c.json({
    sessionId,
    modes: sessionResult.modes || { currentModeId: "code", availableModes: [] },
  });
});

// WebSocket setup
const { injectWebSocket } = setupWebSocket(app as any, {
  connectionManager,
  serverToken,
  snapshotProvider: buildSnapshots,
  onPrompt: handlePrompt,
  onPermissionResponse: handlePermissionResponse,
});

// Start server
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

injectWebSocket(server);

console.log(`\n  Matrix Server running on http://${config.host}:${config.port}`);
console.log(`\n  Auth token: ${serverToken}`);
const advertisedHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
const connectionUri = buildConnectionUri(`http://${advertisedHost}:${config.port}`, serverToken);
console.log(`\n  Connect URI: ${connectionUri}`);
console.log("\n  Scan QR:");
qrcode.generate(connectionUri, { small: true });
console.log(`\n  Registered agents: ${config.agents.map((a) => a.name).join(", ")}\n`);
