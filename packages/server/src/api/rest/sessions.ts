import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

export function sessionRoutes(store: Store, sessionManager: SessionManager, connectionManager: ConnectionManager) {
  const app = new Hono();

  app.get("/sessions", (c) => {
    return c.json(store.listSessions());
  });

  app.get("/sessions/:id/history", (c) => {
    const sessionId = c.req.param("id");
    const sessions = store.listSessions();
    const exists = sessions.some((s) => s.sessionId === sessionId);
    if (!exists) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(store.getHistory(sessionId));
  });

  app.post("/sessions/:id/cancel", (c) => {
    const sessionId = c.req.param("id");
    sessionManager.cancelPrompt(sessionId);
    return c.json({ ok: true });
  });

  app.delete("/sessions/:id", (c) => {
    const sessionId = c.req.param("id");
    sessionManager.closeSession(sessionId, store);
    store.deleteSession(sessionId);
    connectionManager.broadcastToAll({ type: "server:session_closed", sessionId });
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/resume", (c) => {
    const sessionId = c.req.param("id");
    const session = store.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    if (session.status === "active") {
      return c.json({ sessionId });
    }
    if (!session.agentSessionId) {
      return c.json({ error: "Session has no agent conversation to resume" }, 409);
    }

    store.reopenSession(sessionId);
    connectionManager.broadcastToAll({
      type: "server:session_resumed",
      sessionId,
    });

    return c.json({ sessionId });
  });

  return app;
}
