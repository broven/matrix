import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import type { ServerEvent } from "@matrix/sdk";
import { useServerStore } from "./useServerStore";
import { useMatrixClients } from "./useMatrixClients";

/** Default server ID for the local sidecar connection */
const SIDECAR_SERVER_ID = "__sidecar__";

export interface ServerData {
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  agents: AgentListItem[];
  loading: boolean;
  error: string | null;
}

interface AllServersDataResult {
  allSessions: SessionInfo[];
  allRepositories: RepositoryInfo[];
  allWorktrees: Map<string, WorktreeInfo[]>;
  allAgents: Map<string, AgentListItem[]>;
  sessionServerMap: Map<string, string>;
  repoServerMap: Map<string, string>;
  serverDataMap: Map<string, ServerData>;
  /** Trigger a full data refresh for a specific remote server */
  refreshRemoteServer: (serverId: string) => void;
}

/**
 * Aggregates data from all connected remote servers and merges it with sidecar data.
 *
 * Sidecar data (sessions, repositories, worktrees, agents) is passed in so this hook
 * can produce merged all* views without owning the sidecar lifecycle.
 */
export function useAllServersData(sidecar: {
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  agents: AgentListItem[];
}): AllServersDataResult {
  const { servers: savedServers } = useServerStore();
  const { getClient, statuses: multiStatuses } = useMatrixClients();

  // Internal map of serverId → ServerData for remote servers
  const [serverDataMap, setServerDataMap] = useState<Map<string, ServerData>>(new Map());

  // Track previous statuses to detect transitions to "connected"
  const prevStatusesRef = useRef<Map<string, string>>(new Map());

  /** Full data refresh for a single server */
  const refreshServer = useCallback(
    async (serverId: string) => {
      const client = getClient(serverId);
      if (!client) return;

      setServerDataMap((prev) => {
        const existing = prev.get(serverId);
        const next = new Map(prev);
        next.set(serverId, {
          sessions: existing?.sessions ?? [],
          repositories: existing?.repositories ?? [],
          worktrees: existing?.worktrees ?? new Map(),
          agents: existing?.agents ?? [],
          loading: true,
          error: existing?.error ?? null,
        });
        return next;
      });

      try {
        const [agentList, sessionList, repoList] = await Promise.all([
          client.getAgents(),
          client.getSessions(),
          client.getRepositories(),
        ]);

        const wtMap = new Map<string, WorktreeInfo[]>();
        await Promise.all(
          repoList.map(async (repo) => {
            try {
              const wts = await client.getWorktrees(repo.id);
              wtMap.set(repo.id, wts);
            } catch {
              wtMap.set(repo.id, []);
            }
          }),
        );

        setServerDataMap((prev) => {
          const next = new Map(prev);
          next.set(serverId, {
            sessions: sessionList,
            repositories: repoList,
            worktrees: wtMap,
            agents: agentList,
            loading: false,
            error: null,
          });
          return next;
        });
      } catch (err) {
        setServerDataMap((prev) => {
          const next = new Map(prev);
          const existing = prev.get(serverId);
          next.set(serverId, {
            sessions: existing?.sessions ?? [],
            repositories: existing?.repositories ?? [],
            worktrees: existing?.worktrees ?? new Map(),
            agents: existing?.agents ?? [],
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load server data",
          });
          return next;
        });
      }
    },
    [getClient],
  );

  // Effect: refresh when a server transitions to "connected", clean up disconnected servers,
  // and subscribe to incremental events for connected servers.
  useEffect(() => {
    let cancelled = false;
    const unsubs: (() => void)[] = [];
    const connectedServerIds = new Set<string>();

    for (const server of savedServers) {
      const currentStatus = multiStatuses.get(server.id);
      const prevStatus = prevStatusesRef.current.get(server.id);

      if (currentStatus === "connected") {
        connectedServerIds.add(server.id);

        // Full refresh on transition to connected
        if (prevStatus !== "connected") {
          if (!cancelled) {
            refreshServer(server.id);
          }
        }

        // Subscribe to incremental events
        const client = getClient(server.id);
        if (client) {
          const unsub = client.onServerEvent((event: ServerEvent) => {
            if (cancelled) return;
            const sid = server.id;
            switch (event.type) {
              case "server:session_created":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, { ...data, sessions: [...data.sessions, event.session] });
                  return next;
                });
                break;
              case "server:session_closed":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, {
                    ...data,
                    sessions: data.sessions.map((s) =>
                      s.sessionId === event.sessionId
                        ? { ...s, status: "closed" as const }
                        : s
                    ),
                  });
                  return next;
                });
                break;
              case "server:session_deleted":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, {
                    ...data,
                    sessions: data.sessions.filter((s) => s.sessionId !== event.sessionId),
                  });
                  return next;
                });
                break;
              case "server:session_resumed":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, {
                    ...data,
                    sessions: data.sessions.map((s) =>
                      s.sessionId === event.sessionId
                        ? { ...s, status: "active" as const, closeReason: null, suspendedAt: null }
                        : s
                    ),
                  });
                  return next;
                });
                break;
              case "server:repository_added":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, {
                    ...data,
                    repositories: [...data.repositories, event.repository],
                  });
                  return next;
                });
                break;
              case "server:repository_removed":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  const newWorktrees = new Map(data.worktrees);
                  newWorktrees.delete(event.repositoryId);
                  next.set(sid, {
                    ...data,
                    repositories: data.repositories.filter((r) => r.id !== event.repositoryId),
                    worktrees: newWorktrees,
                  });
                  return next;
                });
                break;
              case "server:agents_changed":
                setServerDataMap((prev) => {
                  const data = prev.get(sid);
                  if (!data) return prev;
                  const next = new Map(prev);
                  next.set(sid, { ...data, agents: event.agents });
                  return next;
                });
                break;
            }
          });
          unsubs.push(unsub);
        }
      }
    }

    // Update previous statuses ref
    const newPrevStatuses = new Map<string, string>();
    for (const server of savedServers) {
      const s = multiStatuses.get(server.id);
      if (s) newPrevStatuses.set(server.id, s);
    }
    prevStatusesRef.current = newPrevStatuses;

    // Clean up data for servers that are no longer connected
    setServerDataMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id] of next) {
        if (!connectedServerIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
    };
  }, [savedServers, multiStatuses, getClient, refreshServer]);

  // Visibility change -> full refresh for all connected servers
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      for (const server of savedServers) {
        if (multiStatuses.get(server.id) === "connected") {
          refreshServer(server.id);
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [savedServers, multiStatuses, refreshServer]);

  // Memoized merges: sidecar + all remote servers
  const sessionServerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sidecar.sessions) {
      map.set(s.sessionId, SIDECAR_SERVER_ID);
    }
    for (const [serverId, data] of serverDataMap) {
      for (const s of data.sessions) {
        map.set(s.sessionId, serverId);
      }
    }
    return map;
  }, [sidecar.sessions, serverDataMap]);

  const allSessions = useMemo(() => {
    const merged = [...sidecar.sessions];
    for (const [, data] of serverDataMap) {
      merged.push(...data.sessions);
    }
    return merged;
  }, [sidecar.sessions, serverDataMap]);

  const repoServerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of sidecar.repositories) {
      map.set(r.id, SIDECAR_SERVER_ID);
    }
    for (const [serverId, data] of serverDataMap) {
      for (const r of data.repositories) {
        map.set(r.id, serverId);
      }
    }
    return map;
  }, [sidecar.repositories, serverDataMap]);

  const allRepositories = useMemo(() => {
    const merged = [...sidecar.repositories];
    for (const [, data] of serverDataMap) {
      merged.push(...data.repositories);
    }
    return merged;
  }, [sidecar.repositories, serverDataMap]);

  const allWorktrees = useMemo(() => {
    const merged = new Map(sidecar.worktrees);
    for (const [, data] of serverDataMap) {
      for (const [repoId, wts] of data.worktrees) {
        merged.set(repoId, wts);
      }
    }
    return merged;
  }, [sidecar.worktrees, serverDataMap]);

  const allAgents = useMemo(() => {
    const map = new Map<string, AgentListItem[]>();
    map.set(SIDECAR_SERVER_ID, sidecar.agents);
    for (const [serverId, data] of serverDataMap) {
      map.set(serverId, data.agents);
    }
    return map;
  }, [sidecar.agents, serverDataMap]);

  return {
    allSessions,
    allRepositories,
    allWorktrees,
    allAgents,
    sessionServerMap,
    repoServerMap,
    serverDataMap,
    refreshRemoteServer: refreshServer,
  };
}
