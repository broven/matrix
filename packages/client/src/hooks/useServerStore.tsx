import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { isTauri } from "@/lib/platform";

export interface SavedServer {
  id: string;
  name: string;
  serverUrl: string;
  token: string;
  lastConnected: number | null;
}

interface ServerStoreState {
  servers: SavedServer[];
  addServer: (server: Omit<SavedServer, "id" | "lastConnected">) => string | null;
  removeServer: (id: string) => void;
  updateServer: (id: string, updates: Partial<Pick<SavedServer, "name" | "serverUrl" | "token">>) => void;
  touchServer: (id: string) => void;
  getServer: (id: string) => SavedServer | undefined;
}

const ServerStoreContext = createContext<ServerStoreState>({
  servers: [],
  addServer: () => null,
  removeServer: () => {},
  updateServer: () => {},
  touchServer: () => {},
  getServer: () => undefined,
});

export function useServerStore() {
  return useContext(ServerStoreContext);
}

const STORAGE_KEY = "matrix:servers";

function generateId(): string {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Tauri store instance (lazy-loaded)
let tauriStore: any = null;

async function getTauriStore() {
  if (tauriStore) return tauriStore;
  if (!isTauri()) return null;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    tauriStore = new LazyStore("servers.json");
    return tauriStore;
  } catch {
    return null;
  }
}

async function loadServers(): Promise<SavedServer[]> {
  const store = await getTauriStore();
  if (store) {
    const data: SavedServer[] | undefined = await store.get(STORAGE_KEY);
    return data ?? [];
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

async function persistServers(servers: SavedServer[]): Promise<void> {
  const store = await getTauriStore();
  if (store) {
    await store.set(STORAGE_KEY, servers);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  }
}

export function ServerStoreProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<SavedServer[]>([]);

  useEffect(() => {
    loadServers().then(setServers);
  }, []);

  const save = useCallback((updated: SavedServer[]) => {
    setServers(updated);
    persistServers(updated);
  }, []);

  const addServer = useCallback((server: Omit<SavedServer, "id" | "lastConnected">): string | null => {
    const id = generateId();
    let added = false;
    setServers((prev) => {
      if (prev.some((s) => s.serverUrl === server.serverUrl)) return prev;
      added = true;
      const updated = [...prev, { ...server, id, lastConnected: null }];
      persistServers(updated);
      return updated;
    });
    return added ? id : null;
  }, []);

  const removeServer = useCallback((id: string) => {
    setServers((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      persistServers(updated);
      return updated;
    });
  }, []);

  const updateServer = useCallback((id: string, updates: Partial<Pick<SavedServer, "name" | "serverUrl" | "token">>) => {
    setServers((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...updates } : s));
      persistServers(updated);
      return updated;
    });
  }, []);

  const touchServer = useCallback((id: string) => {
    setServers((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, lastConnected: Date.now() } : s
      );
      persistServers(updated);
      return updated;
    });
  }, []);

  const getServer = useCallback((id: string) => {
    return servers.find((s) => s.id === id);
  }, [servers]);

  return (
    <ServerStoreContext.Provider value={{ servers, addServer, removeServer, updateServer, touchServer, getServer }}>
      {children}
    </ServerStoreContext.Provider>
  );
}
