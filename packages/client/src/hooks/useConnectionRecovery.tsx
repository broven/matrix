import { useEffect } from "react";
import { useMatrixClients } from "./useMatrixClients";
import { useServerStore } from "./useServerStore";

/**
 * Handles connection lifecycle:
 * - On mount: connects to all saved servers in parallel
 * - On visibility change: triggers reconnection for offline servers
 */
export function useConnectionRecovery() {
  const { connect, statuses, manuallyDisconnected } = useMatrixClients();
  const { servers } = useServerStore();

  // Connect to saved servers that don't have a status yet (handles async load)
  useEffect(() => {
    for (const server of servers) {
      if (manuallyDisconnected.has(server.id)) continue;
      const status = statuses.get(server.id);
      if (!status) {
        connect(server.id, {
          serverUrl: server.serverUrl,
          token: server.token,
        });
      }
    }
  }, [servers, statuses, connect, manuallyDisconnected]);

  // On visibility restore, reconnect any offline servers (skip intentionally disconnected)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;

      for (const server of servers) {
        if (manuallyDisconnected.has(server.id)) continue;
        const status = statuses.get(server.id);
        if (status === "offline" || !status) {
          connect(server.id, {
            serverUrl: server.serverUrl,
            token: server.token,
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [servers, statuses, connect, manuallyDisconnected]);
}
