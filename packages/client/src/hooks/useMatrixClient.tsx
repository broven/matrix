import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { MatrixClient, type MatrixClientConfig } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";
import { hasLocalServer, getLocalServerUrl } from "@/lib/platform";

interface ConnectionInfo {
  serverUrl: string;
  token: string;
  tokenMasked: string;
  transport: MatrixClientConfig["transport"];
  source: "manual" | "storage" | "saved";
  serverId?: string;
}

interface MatrixClientState {
  client: MatrixClient | null;
  status: ConnectionStatus;
  connectionInfo: ConnectionInfo | null;
  error: string | null;
  connect: (config: MatrixClientConfig, opts?: { source?: ConnectionInfo["source"]; serverId?: string }) => void;
  restoreLastConnection: () => void;
  disconnect: () => void;
}

const MatrixClientContext = createContext<MatrixClientState>({
  client: null,
  status: "offline",
  connectionInfo: null,
  error: null,
  connect: () => {},
  restoreLastConnection: () => {},
  disconnect: () => {},
});

export function useMatrixClient() {
  return useContext(MatrixClientContext);
}

function maskToken(token: string): string {
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function MatrixClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  const connect = useCallback((config: MatrixClientConfig, opts?: { source?: ConnectionInfo["source"]; serverId?: string }) => {
    connectedRef.current = true;
    setError(null);

    // Disconnect existing client before connecting new one
    setClient((prev: MatrixClient | null) => {
      prev?.disconnect();
      return null;
    });

    const newClient = new MatrixClient(config);
    newClient.onStatusChange((s) => {
      setStatus(s);
      if (s === "connected") setError(null);
    });
    newClient.onError((err) => setError(err.message));
    newClient.connect();
    setClient(newClient);
    setConnectionInfo({
      serverUrl: config.serverUrl,
      token: config.token,
      tokenMasked: maskToken(config.token),
      transport: config.transport ?? "auto",
      source: opts?.source ?? "manual",
      serverId: opts?.serverId,
    });

    sessionStorage.setItem("matrix:lastConnection", JSON.stringify({
      serverUrl: config.serverUrl,
      token: config.token,
      serverId: opts?.serverId,
    }));
  }, []);

  const restoreLastConnection = useCallback(() => {
    const saved = sessionStorage.getItem("matrix:lastConnection");
    if (!saved) return;

    const parsed = JSON.parse(saved) as { serverUrl: string; token: string; serverId?: string };
    setConnectionInfo({
      serverUrl: parsed.serverUrl,
      token: parsed.token,
      tokenMasked: maskToken(parsed.token),
      transport: "auto",
      source: "storage",
      serverId: parsed.serverId,
    });
  }, []);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setStatus("offline");
  }, [client]);

  // Auto-connect to local sidecar on desktop — fetch token from server
  useEffect(() => {
    if (!hasLocalServer()) return;
    if (connectedRef.current) return;

    let cancelled = false;

    const tryConnect = async () => {
      const localServerUrl = await getLocalServerUrl();
      // Poll until sidecar is ready (up to ~15 seconds)
      for (let i = 0; i < 60 && !cancelled; i++) {
        try {
          const res = await fetch(`${localServerUrl}/api/auth-info`, {
            headers: { "X-Matrix-Internal": "true" },
          });
          if (res.ok) {
            const { token } = await res.json() as { token: string };
            if (!cancelled && !connectedRef.current) {
              connect({ serverUrl: localServerUrl, token }, { source: "storage" });
            }
            return;
          }
        } catch {
          // Server not ready yet
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    // Give sidecar a moment to start
    const timer = setTimeout(() => {
      if (!connectedRef.current) {
        tryConnect();
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MatrixClientContext.Provider
      value={{ client, status, connectionInfo, error, connect, restoreLastConnection, disconnect }}
    >
      {children}
    </MatrixClientContext.Provider>
  );
}
