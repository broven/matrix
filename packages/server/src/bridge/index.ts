import type { Hono, Context } from "hono";
import type { ClientRegistry } from "./client-registry.js";
import type { BridgeClientMessage } from "./protocol.js";
import { validateToken } from "../auth/token.js";
import { authMiddleware } from "../auth/middleware.js";

export interface BridgeDeps {
  serverToken: string;
  clientRegistry: ClientRegistry;
  upgradeWebSocket: (handler: (c: any) => any) => any;
}

export function setupBridge(app: Hono, deps: BridgeDeps) {
  const { serverToken, clientRegistry, upgradeWebSocket } = deps;

  // --- WebSocket endpoint ---

  app.get(
    "/bridge",
    upgradeWebSocket((_c: any) => {
      let clientId: string | null = null;
      let authenticated = false;

      return {
        onOpen() {
          // Wait for first message with auth token
        },

        onMessage(event: { data: string }, ws: any) {
          try {
            const msg: { token?: string } & BridgeClientMessage = JSON.parse(event.data as string);

            // First message must contain token for auth
            if (!authenticated) {
              const token = msg.token ?? (msg as any).token;
              if (!token || !validateToken(token, serverToken)) {
                ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Invalid token" }));
                ws.close(4001, "Unauthorized");
                return;
              }
              authenticated = true;

              // If first message is also a register, process it
              if (msg.type === "register") {
                clientId = clientRegistry.register(ws, msg.platform, msg.label, msg.userAgent);
                ws.send(JSON.stringify({ type: "registered", clientId }));
                console.log(`[bridge] Client registered: ${clientId}`);
                return;
              }

              ws.send(JSON.stringify({ type: "authenticated" }));
              return;
            }

            // Authenticated messages
            switch (msg.type) {
              case "register":
                // Late register (auth was separate message)
                if (clientId) {
                  clientRegistry.unregister(clientId);
                }
                clientId = clientRegistry.register(ws, msg.platform, msg.label, msg.userAgent);
                ws.send(JSON.stringify({ type: "registered", clientId }));
                console.log(`[bridge] Client registered: ${clientId}`);
                break;

              case "response":
                if (clientId) {
                  clientRegistry.handleResponse(clientId, msg.requestId, msg.result, msg.error);
                }
                break;

              case "heartbeat":
                ws.send(JSON.stringify({ type: "pong" }));
                break;
            }
          } catch {
            ws.send(JSON.stringify({ type: "error", code: "parse_error", message: "Invalid message" }));
          }
        },

        onClose() {
          if (clientId) {
            console.log(`[bridge] Client disconnected: ${clientId}`);
            clientRegistry.unregister(clientId);
          }
        },
      };
    }),
  );

  // --- HTTP API routes ---

  app.use("/bridge/*", authMiddleware(serverToken));

  app.get("/bridge/clients", (c: Context) => {
    return c.json(clientRegistry.listClients());
  });

  app.get("/bridge/health", (c: Context) => {
    return c.json({
      ok: true,
      clientCount: clientRegistry.size,
      clients: clientRegistry.listClients(),
    });
  });

  app.post("/bridge/eval", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string; script: string }>();
    const requestId = clientRegistry.generateRequestId();

    try {
      const result = await clientRegistry.sendRequest(body.clientId, {
        type: "eval",
        requestId,
        script: body.script,
      });
      return c.json({ ok: true, result, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "eval failed";
      return c.json({ ok: false, result: null, error: message }, 502);
    }
  });

  app.post("/bridge/event", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string; name: string; payload?: unknown }>();
    const requestId = clientRegistry.generateRequestId();

    try {
      await clientRegistry.sendRequest(body.clientId, {
        type: "event",
        requestId,
        name: body.name,
        payload: body.payload,
      });
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "event dispatch failed";
      return c.json({ ok: false, error: message }, 502);
    }
  });

  app.post("/bridge/reset", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string; scopes?: string[] }>();
    const requestId = clientRegistry.generateRequestId();

    try {
      await clientRegistry.sendRequest(body.clientId, {
        type: "reset",
        requestId,
        scopes: body.scopes,
      });
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "reset failed";
      return c.json({ ok: false, error: message }, 502);
    }
  });

  app.post("/bridge/wait", async (c: Context) => {
    const body = await c.req.json<{
      clientId?: string;
      condition: string;
      timeoutMs?: number;
      intervalMs?: number;
    }>();
    const timeoutMs = body.timeoutMs ?? 10_000;
    const intervalMs = body.intervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const requestId = clientRegistry.generateRequestId();
      try {
        const result = await clientRegistry.sendRequest(body.clientId, {
          type: "eval",
          requestId,
          script: body.condition,
        });
        if (result) {
          return c.json({ ok: true, result, error: null });
        }
      } catch {
        // Client error during poll — continue until timeout
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return c.json({ ok: false, result: null, error: `wait timed out after ${timeoutMs}ms` }, 408);
  });
}

export { ClientRegistry } from "./client-registry.js";
