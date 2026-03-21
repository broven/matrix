import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ClientManager, MatrixClient } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";

interface MatrixClientsContextValue {
  /** All connected clients keyed by serverId */
  clients: Map<string, MatrixClient>;
  /** Connection status per server */
  statuses: Map<string, ConnectionStatus>;
  /** Connection error per server */
  errors: Map<string, string | null>;
  /** Server IDs that were intentionally disconnected (should not auto-reconnect) */
  manuallyDisconnected: Set<string>;
  /** Connect to a server */
  connect(serverId: string, config: { serverUrl: string; token: string }): Promise<void>;
  /** Disconnect from a server */
  disconnect(serverId: string): void;
  /** Get client for a specific server */
  getClient(serverId: string): MatrixClient | null;
}

const MatrixClientsContext = createContext<MatrixClientsContextValue>({
  clients: new Map(),
  statuses: new Map(),
  errors: new Map(),
  manuallyDisconnected: new Set(),
  connect: async () => {},
  disconnect: () => {},
  getClient: () => null,
});

export function useMatrixClients() {
  return useContext(MatrixClientsContext);
}

/** Get client + status for a specific server */
export function useServerClient(serverId: string) {
  const { getClient, statuses, errors } = useMatrixClients();
  return {
    client: getClient(serverId),
    status: statuses.get(serverId) ?? ("offline" as ConnectionStatus),
    error: errors.get(serverId) ?? null,
  };
}

export function MatrixClientsProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef(new ClientManager());
  const [clients, setClients] = useState<Map<string, MatrixClient>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, ConnectionStatus>>(new Map());
  const [errors, setErrors] = useState<Map<string, string | null>>(new Map());
  const manuallyDisconnectedRef = useRef(new Set<string>());
  const [manuallyDisconnected, setManuallyDisconnected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const manager = managerRef.current;
    const unsubStatus = manager.onStatusChange((serverId, status) => {
      setStatuses((prev) => new Map(prev).set(serverId, status));
    });
    const unsubError = manager.onError((serverId, error) => {
      setErrors((prev) => new Map(prev).set(serverId, error.message));
    });
    return () => {
      unsubStatus();
      unsubError();
      manager.disconnectAll();
    };
  }, []);

  const connect = useCallback(async (serverId: string, config: { serverUrl: string; token: string }) => {
    const manager = managerRef.current;
    manuallyDisconnectedRef.current.delete(serverId);
    setManuallyDisconnected(new Set(manuallyDisconnectedRef.current));
    setStatuses((prev) => new Map(prev).set(serverId, "connecting"));
    setErrors((prev) => new Map(prev).set(serverId, null));
    try {
      manager.connect(serverId, config);
      setClients(new Map(manager.getConnectedClients()));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setErrors((prev) => new Map(prev).set(serverId, message));
    }
  }, []);

  const disconnect = useCallback((serverId: string) => {
    managerRef.current.disconnect(serverId);
    manuallyDisconnectedRef.current.add(serverId);
    setManuallyDisconnected(new Set(manuallyDisconnectedRef.current));
    setClients(new Map(managerRef.current.getConnectedClients()));
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(serverId, "offline");
      return next;
    });
  }, []);

  const getClient = useCallback((serverId: string) => {
    return managerRef.current.getClient(serverId);
  }, []);

  return (
    <MatrixClientsContext.Provider value={{ clients, statuses, errors, manuallyDisconnected, connect, disconnect, getClient }}>
      {children}
    </MatrixClientsContext.Provider>
  );
}
