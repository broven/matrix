import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import type { ClientMessage, PermissionOutcome } from "@matrix/protocol";
import type { ConnectionManager } from "./connection-manager.js";
import { nanoid } from "nanoid";
import { validateToken } from "../../auth/token.js";
import type { ServerMessage } from "@matrix/protocol";

type SubscribeMessage = {
  type: "session:subscribe";
  sessionId: string;
  lastEventId?: string;
};

export interface WsHandlerDeps {
  connectionManager: ConnectionManager;
  serverToken: string;
  snapshotProvider: (sessionId?: string) => Array<Extract<ServerMessage, { type: "session:snapshot" }>>;
  onPrompt: (sessionId: string, prompt: Array<{ type: string; text: string }>) => void;
  onPermissionResponse: (sessionId: string, toolCallId: string, outcome: PermissionOutcome) => void;
}

export function setupWebSocket(app: Hono, deps: WsHandlerDeps) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const connectionId = nanoid();

      return {
        onOpen(_event, ws) {
          const token = new URL(c.req.url, "http://localhost").searchParams.get("token");
          if (!token || !validateToken(token, deps.serverToken)) {
            ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Invalid token" }));
            ws.close(4001, "Unauthorized");
            return;
          }
          deps.connectionManager.addConnection(connectionId, ws as any);
        },

        onMessage(event, ws) {
          try {
            const msg: ClientMessage | SubscribeMessage = JSON.parse(event.data as string);

            switch (msg.type) {
              case "session:prompt":
                deps.connectionManager.subscribeToSession(connectionId, msg.sessionId);
                deps.onPrompt(msg.sessionId, msg.prompt);
                break;

              case "session:subscribe":
                deps.connectionManager.subscribeToSession(connectionId, msg.sessionId);
                if (msg.lastEventId) {
                  const replayed = deps.connectionManager.replayMissed(
                    connectionId,
                    msg.sessionId,
                    Number.parseInt(msg.lastEventId, 10),
                  );
                  if (!replayed) {
                    for (const snapshot of deps.snapshotProvider(msg.sessionId)) {
                      ws.send(JSON.stringify(snapshot));
                    }
                  }
                }
                break;

              case "session:permission_response":
                deps.onPermissionResponse(msg.sessionId, msg.toolCallId, msg.outcome);
                break;

              case "ping":
                ws.send(JSON.stringify({ type: "pong" }));
                break;
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: "error", code: "parse_error", message: "Invalid message" }));
          }
        },

        onClose() {
          deps.connectionManager.removeConnection(connectionId);
        },
      };
    }),
  );

  return { injectWebSocket };
}
