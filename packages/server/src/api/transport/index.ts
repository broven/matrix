import { Hono } from "hono";
import type { ClientMessage, PermissionOutcome, ServerMessage } from "@matrix/protocol";
import { authMiddleware } from "../../auth/middleware.js";
import { validateToken } from "../../auth/token.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

type SnapshotMessage = Extract<ServerMessage, { type: "session:snapshot" }>;
type SubscribeMessage = {
  type: "session:subscribe";
  sessionId: string;
  lastEventId?: string;
};

export interface TransportRouteDeps {
  connectionManager: ConnectionManager;
  serverToken: string;
  snapshotProvider: (sessionId?: string) => SnapshotMessage[];
  onPrompt: (sessionId: string, prompt: Array<{ type: string; text: string }>) => void;
  onPermissionResponse: (sessionId: string, toolCallId: string, outcome: PermissionOutcome) => void;
}

export function createTransportRoutes(deps: TransportRouteDeps) {
  const app = new Hono();

  app.post("/messages", authMiddleware(deps.serverToken), async (c) => {
    const msg = await c.req.json<ClientMessage | SubscribeMessage>();
    handleClientMessage(msg, deps);
    return c.json({ ok: true }, 202);
  });

  app.get("/poll", authMiddleware(deps.serverToken), (c) => {
    const lastEventId = Number.parseInt(
      c.req.query("lastEventId") ?? c.req.header("Last-Event-ID") ?? "0",
      10,
    );
    const result = deps.connectionManager.getMessagesSince(lastEventId);
    return c.json(result.needsSnapshot ? deps.snapshotProvider() : result.messages);
  });

  app.get("/sse", (c) => {
    const token = c.req.query("token");
    if (!token || !validateToken(token, deps.serverToken)) {
      return c.json({ error: "Invalid token" }, 401);
    }

    const lastEventId = Number.parseInt(c.req.query("lastEventId") ?? "0", 10);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (message: ServerMessage) => {
          const lines = [];
          if ("eventId" in message) {
            lines.push(`id: ${message.eventId}`);
          }
          lines.push(`data: ${JSON.stringify(message)}`);
          lines.push("");
          controller.enqueue(encoder.encode(lines.join("\n")));
        };

        const result = deps.connectionManager.getMessagesSince(lastEventId);
        const initialMessages = result.needsSnapshot
          ? deps.snapshotProvider()
          : result.messages;
        for (const message of initialMessages) {
          send(message);
        }

        const unsubscribe = deps.connectionManager.onMessage(send);
        const abortHandler = () => {
          unsubscribe();
          controller.close();
        };

        c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}

function handleClientMessage(msg: ClientMessage | SubscribeMessage, deps: TransportRouteDeps): void {
  switch (msg.type) {
    case "session:prompt":
      deps.onPrompt(msg.sessionId, msg.prompt);
      break;
    case "session:permission_response":
      deps.onPermissionResponse(msg.sessionId, msg.toolCallId, msg.outcome);
      break;
    case "session:subscribe":
    case "ping":
      break;
  }
}
