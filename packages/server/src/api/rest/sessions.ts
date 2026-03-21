import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

/** Cache git ls-files results per cwd with a 30-second TTL */
const fileListCache = new Map<string, { files: string[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

async function getTrackedFiles(cwd: string): Promise<string[]> {
  const cached = fileListCache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.files;
  }

  const proc = Bun.spawn(["git", "ls-files"], { cwd, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const files = text.trim().split("\n").filter(Boolean);

  fileListCache.set(cwd, { files, expiresAt: Date.now() + CACHE_TTL_MS });
  return files;
}

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

    const query = (c.req.query("q") ?? "").toLowerCase();
    const limit = 50;

    try {
      const allFiles = await getTrackedFiles(cwd);

      // Server-side filtering and limiting
      if (!query) {
        return c.json(allFiles.slice(0, limit));
      }
      const filtered: string[] = [];
      for (const f of allFiles) {
        if (f.toLowerCase().includes(query)) {
          filtered.push(f);
          if (filtered.length >= limit) break;
        }
      }
      return c.json(filtered);
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
