import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";
import { testAcpAgent } from "./test-acp-agent.js";

export function agentRoutes(agentManager: AgentManager) {
  const app = new Hono();

  app.get("/agents", (c) => {
    return c.json(agentManager.listAgents());
  });

  // Test any agent (builtin or custom) by ID
  app.post("/agents/:id/test", async (c) => {
    const id = c.req.param("id");
    const config = agentManager.getConfig(id);
    if (!config) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const result = await testAcpAgent({
      command: config.command,
      args: config.args,
      env: config.env,
    });
    return c.json(result);
  });

  return app;
}
