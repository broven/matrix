import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { MatrixClient, type MatrixClientConfig } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";

interface MatrixClientState {
  client: MatrixClient | null;
  status: ConnectionStatus;
  connect: (config: MatrixClientConfig) => void;
  disconnect: () => void;
}

const MatrixClientContext = createContext<MatrixClientState>({
  client: null,
  status: "offline",
  connect: () => {},
  disconnect: () => {},
});

export function useMatrixClient() {
  return useContext(MatrixClientContext);
}

export function MatrixClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("offline");

  const connect = useCallback((config: MatrixClientConfig) => {
    const newClient = new MatrixClient(config);
    newClient.onStatusChange(setStatus);
    newClient.connect();
    setClient(newClient);

    localStorage.setItem("matrix:lastConnection", JSON.stringify({
      serverUrl: config.serverUrl,
      token: config.token,
    }));
  }, []);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setStatus("offline");
  }, [client]);

  return (
    <MatrixClientContext.Provider value={{ client, status, connect, disconnect }}>
      {children}
    </MatrixClientContext.Provider>
  );
}
