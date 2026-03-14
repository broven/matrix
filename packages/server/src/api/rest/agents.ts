import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";

export function agentRoutes(agentManager: AgentManager) {
  const app = new Hono();

  app.get("/agents", (c) => {
    return c.json(agentManager.listAgents());
  });

  return app;
}
