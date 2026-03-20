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

  app.post("/bridge/snapshot", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string }>();
    const requestId = clientRegistry.generateRequestId();

    try {
      const result = await clientRegistry.sendRequest(body.clientId, {
        type: "snapshot",
        requestId,
      });
      return c.json({ ok: true, result, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "snapshot failed";
      return c.json({ ok: false, result: null, error: message }, 502);
    }
  });

  app.post("/bridge/screenshot", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string }>();
    const client = clientRegistry.getClient(body.clientId);

    if (!client) {
      const msg = body.clientId
        ? `Client "${body.clientId}" not found`
        : "No clients connected";
      return c.json({ ok: false, error: msg }, 502);
    }

    try {
      let base64Data: string;

      if (client.info.platform === "ios") {
        // iOS Simulator: capture via xcrun simctl on host
        const { execSync } = await import("node:child_process");
        const { readFileSync, unlinkSync } = await import("node:fs");
        const { randomUUID } = await import("node:crypto");
        const tmpFile = `/tmp/matrix-screenshot-${randomUUID()}.png`;
        execSync(`xcrun simctl io booted screenshot "${tmpFile}"`, {
          timeout: 10_000,
        });
        base64Data = readFileSync(tmpFile).toString("base64");
        unlinkSync(tmpFile);
      } else {
        // macOS: relay through WebSocket to Tauri command
        const requestId = clientRegistry.generateRequestId();
        const result = await clientRegistry.sendRequest(body.clientId, {
          type: "screenshot",
          requestId,
        });
        base64Data = result as string;
      }

      // Return raw PNG binary
      const pngBuffer = Buffer.from(base64Data, "base64");
      return new Response(pngBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(pngBuffer.length),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "screenshot failed";
      return c.json({ ok: false, error: message }, 502);
    }
  });
}

export { ClientRegistry } from "./client-registry.js";
