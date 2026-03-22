import type { Hono, Context } from "hono";
import type { ClientRegistry } from "./client-registry.js";
import type { BridgeClientMessage } from "./protocol.js";
import { validateToken } from "../auth/token.js";
import { authMiddleware } from "../auth/middleware.js";
import { logger } from "../logger.js";

const log = logger.child({ target: "bridge" });

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
                log.info({ clientId }, "client registered");
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
                log.info({ clientId }, "client registered");
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
            log.info({ clientId }, "client disconnected");
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
        const { exec } = await import("node:child_process");
        const { readFile, unlink } = await import("node:fs/promises");
        const { randomUUID } = await import("node:crypto");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Resolve which simulator to capture — "booted" only works when
        // exactly one simulator is running; with multiple we need a UDID.
        const { stdout: deviceJson } = await execAsync(
          "xcrun simctl list devices booted -j",
          { timeout: 5_000 },
        );
        const parsed = JSON.parse(deviceJson) as {
          devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
        };
        const booted = Object.values(parsed.devices).flat().filter((d) => d.state === "Booted");
        if (booted.length === 0) {
          return c.json({ ok: false, error: "No booted iOS simulators found" }, 502);
        }
        if (booted.length > 1) {
          return c.json(
            { ok: false, error: `Multiple booted simulators (${booted.map((d) => d.name).join(", ")}); boot only one simulator for iOS screenshot capture` },
            502,
          );
        }
        const simUdid = booted[0].udid;

        const tmpFile = `/tmp/matrix-screenshot-${randomUUID()}.png`;
        await execAsync(`xcrun simctl io "${simUdid}" screenshot "${tmpFile}"`, {
          timeout: 10_000,
        });
        base64Data = (await readFile(tmpFile)).toString("base64");
        await unlink(tmpFile).catch(() => {});
      } else {
        // macOS: try Tauri command via WebSocket, fallback to screencapture CLI
        try {
          const requestId = clientRegistry.generateRequestId();
          const result = await clientRegistry.sendRequest(body.clientId, {
            type: "screenshot",
            requestId,
          });
          base64Data = result as string;
        } catch {
          // Tauri invoke unavailable (e.g. dev mode via browser) — use screencapture CLI
          const { exec } = await import("node:child_process");
          const { readFile, unlink } = await import("node:fs/promises");
          const { randomUUID } = await import("node:crypto");
          const { promisify } = await import("node:util");
          const execAsync = promisify(exec);
          const tmpFile = `/tmp/matrix-screenshot-${randomUUID()}.png`;
          // Try to find the Matrix window ID for targeted capture
          try {
            const { stdout: wid } = await execAsync(
              `osascript -e 'tell application "System Events" to tell (first process whose unix id is ${process.pid} or name contains "matrix-client") to get id of first window'`,
              { timeout: 3_000 },
            );
            const windowId = wid.trim();
            if (windowId) {
              await execAsync(`screencapture -l ${windowId} -o -x "${tmpFile}"`, { timeout: 10_000 });
            } else {
              await execAsync(`screencapture -x "${tmpFile}"`, { timeout: 10_000 });
            }
          } catch {
            // osascript failed — fallback to full-screen capture
            await execAsync(`screencapture -x "${tmpFile}"`, { timeout: 10_000 });
          }
          base64Data = (await readFile(tmpFile)).toString("base64");
          await unlink(tmpFile).catch(() => {});
        }
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
