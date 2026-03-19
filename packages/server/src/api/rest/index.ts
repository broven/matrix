import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { WorktreeManager } from "../../worktree-manager/index.js";
import type { CloneManager } from "../../clone-manager/index.js";
import { agentRoutes } from "./agents.js";
import { sessionRoutes } from "./sessions.js";
import { repositoryRoutes } from "./repositories.js";
import { filesystemRoutes } from "./filesystem.js";
import { serverConfigRoutes } from "./server-config.js";
import { customAgentRoutes } from "./custom-agents.js";

interface RestRouteDeps {
  agentManager: AgentManager;
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  cloneManager: CloneManager;
  onAgentConfigChange: () => void;
}

export function createRestRoutes(deps: RestRouteDeps) {
  const app = new Hono();
  app.route("/", agentRoutes(deps.agentManager));
  app.route("/", sessionRoutes(deps.store, deps.sessionManager));
  app.route("/", repositoryRoutes({
    store: deps.store,
    sessionManager: deps.sessionManager,
    worktreeManager: deps.worktreeManager,
    cloneManager: deps.cloneManager,
  }));
  app.route("/", filesystemRoutes());
  app.route("/", serverConfigRoutes());
  app.route("/", customAgentRoutes({
    store: deps.store,
    agentManager: deps.agentManager,
    onConfigChange: deps.onAgentConfigChange,
  }));
  return app;
}
