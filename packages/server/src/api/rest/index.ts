import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import { agentRoutes } from "./agents.js";
import { sessionRoutes } from "./sessions.js";

export function createRestRoutes(agentManager: AgentManager, store: Store, sessionManager: SessionManager) {
  const app = new Hono();
  app.route("/", agentRoutes(agentManager));
  app.route("/", sessionRoutes(store, sessionManager));
  return app;
}
