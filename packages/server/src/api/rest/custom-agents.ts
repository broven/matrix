import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import { Hono } from "hono";
import type { AgentTestStep, AgentTestResult } from "@matrix/protocol";
import { encodeJsonRpc, parseJsonRpcMessages, type JsonRpcMessage } from "../../acp-bridge/jsonrpc.js";
import type { Store } from "../../store/index.js";
import type { AgentManager } from "../../agent-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

interface CustomAgentRouteDeps {
  store: Store;
  agentManager: AgentManager;
  connectionManager: ConnectionManager;
  onConfigChange: () => void;
}

function validateEnvPayload(env: unknown): string | null {
  if (env === undefined || env === null) return null;
  if (typeof env !== "object" || Array.isArray(env)) {
    return "env must be an object mapping strings to strings";
  }
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") {
      return "env keys and values must be strings";
    }
  }
  return null;
}

function validateAgentPayload(body: Record<string, unknown>): string | null {
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return "name must be a non-empty string";
  }
  if (body.command !== undefined && (typeof body.command !== "string" || !body.command.trim())) {
    return "command must be a non-empty string";
  }
  if (body.args !== undefined) {
    if (!Array.isArray(body.args) || !body.args.every((a: unknown) => typeof a === "string")) {
      return "args must be an array of strings";
    }
  }
  const envError = validateEnvPayload(body.env);
  if (envError) return envError;
  if (body.icon !== undefined && body.icon !== null && typeof body.icon !== "string") {
    return "icon must be a string";
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
    return "description must be a string";
  }
  return null;
}

const SPAWN_TIMEOUT_MS = 3_000;
const STEP_TIMEOUT_MS = 5_000;

/**
 * Test an ACP agent by spawning it and running through protocol steps.
 * Lightweight — does NOT reuse AcpBridge.
 */
async function testAcpAgent(config: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<AgentTestResult> {
  const steps: AgentTestStep[] = [];
  let proc: ChildProcess | null = null;
  let buffer = "";
  let nextId = 1;

  function addStep(name: AgentTestStep["name"], status: AgentTestStep["status"], durationMs: number, error?: string): void {
    steps.push({ name, status, durationMs, ...(error ? { error } : {}) });
  }

  function skipRemaining(from: number): void {
    const allSteps: AgentTestStep["name"][] = ["spawn", "initialize", "session/new", "prompt"];
    for (let i = from; i < allSteps.length; i++) {
      addStep(allSteps[i], "skipped", 0);
    }
  }

  function sendRequest(method: string, params: unknown): number {
    const id = nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    proc!.stdin!.write(encodeJsonRpc(message));
    return id;
  }

  function waitForResponse(requestId: number, timeoutMs: number, opts?: { acceptNotifications?: boolean }): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      function onData(data: Buffer) {
        buffer += data.toString();
        const { messages, remainder } = parseJsonRpcMessages(buffer);
        buffer = remainder;
        for (const msg of messages) {
          if (msg.id === requestId && (msg.result !== undefined || msg.error !== undefined)) {
            clearTimeout(timer);
            proc!.stdout!.off("data", onData);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg);
            }
            return;
          }
          // Accept notifications as evidence the agent is alive (e.g. session/update during prompt)
          if (opts?.acceptNotifications && msg.id === undefined && msg.method !== undefined) {
            clearTimeout(timer);
            proc!.stdout!.off("data", onData);
            resolve(msg);
            return;
          }
        }
      }

      proc!.stdout!.on("data", onData);
    });
  }

  function cleanup(): void {
    if (proc && !proc.killed) {
      proc.kill();
    }
  }

  try {
    // Step 1: spawn
    const spawnStart = Date.now();
    try {
      proc = await new Promise<ChildProcess>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out after ${SPAWN_TIMEOUT_MS}ms`)), SPAWN_TIMEOUT_MS);
        const child = spawn(config.command, config.args, {
          env: { ...process.env, ...config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        // Consider spawn successful once the process has a pid
        // Use a short delay to catch immediate failures (e.g. ENOENT)
        setTimeout(() => {
          clearTimeout(timer);
          if (child.killed || child.exitCode !== null) {
            reject(new Error("Process exited immediately"));
          } else {
            resolve(child);
          }
        }, 200);
      });
      addStep("spawn", "pass", Date.now() - spawnStart);
    } catch (err: any) {
      addStep("spawn", "fail", Date.now() - spawnStart, err.message);
      skipRemaining(1);
      return { steps };
    }

    // Step 2: initialize
    const initStart = Date.now();
    try {
      const id = sendRequest("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "matrix-test", version: "1.0.0" },
      });
      await waitForResponse(id, STEP_TIMEOUT_MS);
      addStep("initialize", "pass", Date.now() - initStart);
    } catch (err: any) {
      addStep("initialize", "fail", Date.now() - initStart, err.message);
      skipRemaining(2);
      return { steps };
    }

    // Step 3: session/new
    const sessionStart = Date.now();
    let agentSessionId: string | undefined;
    try {
      const id = sendRequest("session/new", { cwd: os.tmpdir(), mcpServers: [] });
      const response = await waitForResponse(id, STEP_TIMEOUT_MS);
      agentSessionId = (response.result as any)?.sessionId;
      if (typeof agentSessionId !== "string" || !agentSessionId) {
        throw new Error("session/new response missing sessionId");
      }
      addStep("session/new", "pass", Date.now() - sessionStart);
    } catch (err: any) {
      addStep("session/new", "fail", Date.now() - sessionStart, err.message);
      skipRemaining(3);
      return { steps };
    }

    // Step 4: prompt
    const promptStart = Date.now();
    try {
      const id = sendRequest("session/prompt", {
        sessionId: agentSessionId,
        prompt: [{ type: "text", text: "hello" }],
      });
      // Wait for result or any notification (e.g. session/update) as evidence agent is responding
      await waitForResponse(id, STEP_TIMEOUT_MS, { acceptNotifications: true });
      addStep("prompt", "pass", Date.now() - promptStart);
    } catch (err: any) {
      addStep("prompt", "fail", Date.now() - promptStart, err.message);
    }

    return { steps };
  } finally {
    cleanup();
  }
}

export function customAgentRoutes(deps: CustomAgentRouteDeps) {
  const app = new Hono();

  // List custom agents
  app.get("/custom-agents", (c) => {
    return c.json(deps.store.listCustomAgents());
  });

  // Create custom agent
  app.post("/custom-agents", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.command) {
      return c.json({ error: "name and command are required" }, 400);
    }

    const validationError = validateAgentPayload(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const agent = deps.store.createCustomAgent({
      id: body.id,
      name: body.name,
      command: body.command,
      args: body.args ?? [],
      env: body.env,
      icon: body.icon,
      description: body.description,
    });
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json(agent, 201);
  });

  // Update custom agent
  app.put("/custom-agents/:id", async (c) => {
    const id = c.req.param("id");
    const existing = deps.store.getCustomAgent(id);
    if (!existing) {
      return c.json({ error: "Custom agent not found" }, 404);
    }

    const body = await c.req.json();
    const validationError = validateAgentPayload(body);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const updated = deps.store.updateCustomAgent(id, body);
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json(updated);
  });

  // Delete custom agent (cascades to profiles)
  app.delete("/custom-agents/:id", (c) => {
    const id = c.req.param("id");
    const existing = deps.store.getCustomAgent(id);
    if (!existing) {
      return c.json({ error: "Custom agent not found" }, 404);
    }

    deps.store.deleteCustomAgent(id);
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json({ ok: true });
  });

  // Test custom agent ACP protocol
  app.post("/custom-agents/test", async (c) => {
    const body = await c.req.json();
    if (!body.command) {
      return c.json({ error: "command is required" }, 400);
    }

    const validationError = validateAgentPayload({ ...body, name: body.name ?? "test" });
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const result = await testAcpAgent({
      command: body.command,
      args: body.args ?? [],
      env: body.env,
    });
    return c.json(result);
  });

  // ── Agent Env Profiles ──────────────────────────────────────────

  // List profiles (optionally filter by parentAgentId)
  app.get("/agent-profiles", (c) => {
    const parentAgentId = c.req.query("parentAgentId");
    return c.json(deps.store.listAgentEnvProfiles(parentAgentId));
  });

  // Create profile
  app.post("/agent-profiles", async (c) => {
    const body = await c.req.json();
    if (!body.parentAgentId || !body.name) {
      return c.json({ error: "parentAgentId and name are required" }, 400);
    }

    const envError = validateEnvPayload(body.env);
    if (envError) {
      return c.json({ error: envError }, 400);
    }

    const profile = deps.store.createAgentEnvProfile({
      parentAgentId: body.parentAgentId,
      name: body.name,
      env: body.env ?? {},
    });
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json(profile, 201);
  });

  // Update profile
  app.put("/agent-profiles/:id", async (c) => {
    const id = c.req.param("id");
    const existing = deps.store.getAgentEnvProfile(id);
    if (!existing) {
      return c.json({ error: "Profile not found" }, 404);
    }

    const body = await c.req.json();
    const envError = validateEnvPayload(body.env);
    if (envError) {
      return c.json({ error: envError }, 400);
    }
    const updated = deps.store.updateAgentEnvProfile(id, body);
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json(updated);
  });

  // Delete profile
  app.delete("/agent-profiles/:id", (c) => {
    const id = c.req.param("id");
    const existing = deps.store.getAgentEnvProfile(id);
    if (!existing) {
      return c.json({ error: "Profile not found" }, 404);
    }

    deps.store.deleteAgentEnvProfile(id);
    deps.onConfigChange();
    const agents = deps.agentManager.listAgents();
    deps.connectionManager.broadcastToAll({ type: "server:agents_changed", agents });
    return c.json({ ok: true });
  });

  return app;
}
