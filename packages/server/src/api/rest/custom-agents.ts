import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { AgentManager } from "../../agent-manager/index.js";

interface CustomAgentRouteDeps {
  store: Store;
  agentManager: AgentManager;
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
    return c.json({ ok: true });
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
    return c.json({ ok: true });
  });

  return app;
}
