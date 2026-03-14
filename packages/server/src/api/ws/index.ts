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
  onCancel: (sessionId: string) => void;
  onPermissionResponse: (sessionId: string, toolCallId: string, outcome: PermissionOutcome) => void;
}

export function setupWebSocket(app: Hono, deps: WsHandlerDeps) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const connectionId = nanoid();
      let authenticated = false;

      return {
        onOpen(_event, _ws) {
          // Wait for auth message — do not add to connection manager yet
        },

        onMessage(event, ws) {
          try {
            const msg = JSON.parse(event.data as string);

            // First message must be an auth message
            if (!authenticated) {
              if (msg.type !== "auth" || !msg.token) {
                ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "First message must be auth" }));
                ws.close(4001, "Unauthorized");
                return;
              }
              if (!validateToken(msg.token, deps.serverToken)) {
                ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Invalid token" }));
                ws.close(4001, "Unauthorized");
                return;
              }
              authenticated = true;
              deps.connectionManager.addConnection(connectionId, ws as any);
              ws.send(JSON.stringify({ type: "authenticated" }));
              return;
            }

            const clientMsg: ClientMessage | SubscribeMessage = msg;

            switch (clientMsg.type) {
              case "session:prompt":
                deps.connectionManager.subscribeToSession(connectionId, clientMsg.sessionId);
                deps.onPrompt(clientMsg.sessionId, clientMsg.prompt);
                break;

              case "session:cancel":
                deps.onCancel(clientMsg.sessionId);
                break;

              case "session:subscribe":
                deps.connectionManager.subscribeToSession(connectionId, clientMsg.sessionId);
                if (clientMsg.lastEventId) {
                  const replayed = deps.connectionManager.replayMissed(
                    connectionId,
                    clientMsg.sessionId,
                    Number.parseInt(clientMsg.lastEventId, 10),
                  );
                  if (!replayed) {
                    for (const snapshot of deps.snapshotProvider(clientMsg.sessionId)) {
                      ws.send(JSON.stringify(snapshot));
                    }
                  }
                }
                break;

              case "session:permission_response":
                deps.onPermissionResponse(clientMsg.sessionId, clientMsg.toolCallId, clientMsg.outcome);
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
