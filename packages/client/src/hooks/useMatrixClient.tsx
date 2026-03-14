import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { MatrixClient, type MatrixClientConfig } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";

interface ConnectionInfo {
  serverUrl: string;
  token: string;
  tokenMasked: string;
  transport: MatrixClientConfig["transport"];
  source: "manual" | "storage";
}

interface MatrixClientState {
  client: MatrixClient | null;
  status: ConnectionStatus;
  connectionInfo: ConnectionInfo | null;
  connect: (config: MatrixClientConfig) => void;
  restoreLastConnection: () => void;
  disconnect: () => void;
}

const MatrixClientContext = createContext<MatrixClientState>({
  client: null,
  status: "offline",
  connectionInfo: null,
  connect: () => {},
  restoreLastConnection: () => {},
  disconnect: () => {},
});

export function useMatrixClient() {
  return useContext(MatrixClientContext);
}

export function MatrixClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);

  const buildConnectionInfo = useCallback(
    (config: MatrixClientConfig, source: ConnectionInfo["source"]): ConnectionInfo => ({
      serverUrl: config.serverUrl,
      token: config.token,
      tokenMasked:
        config.token.length <= 8
          ? config.token
          : `${config.token.slice(0, 4)}...${config.token.slice(-4)}`,
      transport: config.transport ?? "auto",
      source,
    }),
    [],
  );

  const connect = useCallback((config: MatrixClientConfig) => {
    const newClient = new MatrixClient(config);
    newClient.onStatusChange(setStatus);
    newClient.connect();
    setClient(newClient);
    setConnectionInfo(buildConnectionInfo(config, "manual"));

    sessionStorage.setItem("matrix:lastConnection", JSON.stringify({
      serverUrl: config.serverUrl,
      token: config.token,
    }));
  }, [buildConnectionInfo]);

  const restoreLastConnection = useCallback(() => {
    const saved = sessionStorage.getItem("matrix:lastConnection");
    if (!saved) return;

    const parsed = JSON.parse(saved) as { serverUrl: string; token: string };
    setConnectionInfo(
      buildConnectionInfo(
        { serverUrl: parsed.serverUrl, token: parsed.token, transport: "auto" },
        "storage",
      ),
    );
  }, [buildConnectionInfo]);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setStatus("offline");
  }, [client]);

  return (
    <MatrixClientContext.Provider
      value={{ client, status, connectionInfo, connect, restoreLastConnection, disconnect }}
    >
      {children}
    </MatrixClientContext.Provider>
  );
}
