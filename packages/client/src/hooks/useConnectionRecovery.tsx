import { useEffect } from "react";
import { useMatrixClients } from "./useMatrixClients";
import { useServerStore } from "./useServerStore";

/**
 * Handles connection lifecycle:
 * - On mount: connects to all saved servers in parallel
 * - On visibility change: triggers reconnection for offline servers
 */
export function useConnectionRecovery() {
  const { connect, statuses } = useMatrixClients();
  const { servers } = useServerStore();

  // Connect to all saved servers on mount
  useEffect(() => {
    for (const server of servers) {
      connect(server.id, {
        serverUrl: server.serverUrl,
        token: server.token,
      });
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On visibility restore, reconnect any offline servers
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;

      for (const server of servers) {
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
  }, [servers, statuses, connect]);
}
