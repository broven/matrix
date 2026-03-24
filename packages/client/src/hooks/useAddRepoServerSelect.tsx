import { useState, useEffect, useCallback, useMemo } from "react";
import { useMatrixClient } from "./useMatrixClient";
import { useMatrixClients } from "./useMatrixClients";
import { useServerStore } from "./useServerStore";
import type { MatrixClient } from "@matrix/sdk";
import { isTauri } from "@/lib/platform";

const SIDECAR_SERVER_ID = "__sidecar__";
const STORAGE_KEY = "matrix:lastAddRepoServerId";

export interface ServerOption {
  id: string;
  name: string;
  client: MatrixClient;
}

export interface UseAddRepoServerSelectResult {
  servers: ServerOption[];
  selectedServerId: string;
  setSelectedServerId: (id: string) => void;
  selectedClient: MatrixClient | null;
  /** Only show selector when more than 1 server is available */
  showSelector: boolean;
}

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

async function loadLastServerId(): Promise<string | null> {
  const store = await getTauriStore();
  if (store) {
    return (await store.get(STORAGE_KEY)) ?? null;
  }
  return localStorage.getItem(STORAGE_KEY);
}

async function persistLastServerId(id: string): Promise<void> {
  const store = await getTauriStore();
  if (store) {
    await store.set(STORAGE_KEY, id);
  } else {
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function useAddRepoServerSelect(): UseAddRepoServerSelectResult {
  const { client: sidecarClient, status: sidecarStatus } = useMatrixClient();
  const { clients: remoteClients, statuses: remoteStatuses } = useMatrixClients();
  const { servers: savedServers } = useServerStore();

  const [lastServerId, setLastServerId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerIdState] = useState<string>("");

  // Load persisted last server ID
  useEffect(() => {
    loadLastServerId().then(setLastServerId);
  }, []);

  // Build available servers list
  const servers = useMemo(() => {
    const list: ServerOption[] = [];

    // Sidecar (local)
    if (sidecarClient && sidecarStatus === "connected") {
      list.push({ id: SIDECAR_SERVER_ID, name: "Local", client: sidecarClient });
    }

    // Remote servers
    for (const saved of savedServers) {
      const client = remoteClients.get(saved.id);
      const status = remoteStatuses.get(saved.id);
      if (client && status === "connected") {
        list.push({ id: saved.id, name: saved.name, client });
      }
    }

    return list;
  }, [sidecarClient, sidecarStatus, savedServers, remoteClients, remoteStatuses]);

  // Compute default selection when servers or lastServerId changes
  useEffect(() => {
    if (servers.length === 0) {
      setSelectedServerIdState("");
      return;
    }

    // If current selection is still valid, keep it
    if (selectedServerId && servers.some((s) => s.id === selectedServerId)) {
      return;
    }

    // Try last-used server
    if (lastServerId && servers.some((s) => s.id === lastServerId)) {
      setSelectedServerIdState(lastServerId);
      return;
    }

    // Try sidecar
    if (servers.some((s) => s.id === SIDECAR_SERVER_ID)) {
      setSelectedServerIdState(SIDECAR_SERVER_ID);
      return;
    }

    // First available
    setSelectedServerIdState(servers[0].id);
  }, [servers, lastServerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelectedServerId = useCallback((id: string) => {
    setSelectedServerIdState(id);
    setLastServerId(id);
    persistLastServerId(id);
  }, []);

  const selectedClient = useMemo(() => {
    return servers.find((s) => s.id === selectedServerId)?.client ?? null;
  }, [servers, selectedServerId]);

  return {
    servers,
    selectedServerId,
    setSelectedServerId,
    selectedClient,
    showSelector: servers.length > 1,
  };
}
