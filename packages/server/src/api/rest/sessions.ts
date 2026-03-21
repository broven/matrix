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

  app.get("/sessions/:id/files", async (c) => {
    const sessionId = c.req.param("id");
    const session = store.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const cwd = session.cwd;
    if (!cwd) {
      return c.json([]);
    }

    try {
      const proc = Bun.spawn(["git", "ls-files"], { cwd, stdout: "pipe", stderr: "pipe" });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const files = text.trim().split("\n").filter(Boolean);
      return c.json(files);
    } catch {
      return c.json([]);
    }
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

  return app;
}
