import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentListItem, SessionInfo, RepositoryInfo, WorktreeInfo, ServerConfig } from "@matrix/protocol";
import type { ServerEvent } from "@matrix/sdk";
import { useMatrixClients } from "./useMatrixClients";

export interface ServerData {
  agents: AgentListItem[];
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  serverConfig: ServerConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads and manages all data for a specific server.
 * Subscribes to incremental server events and handles full refresh on reconnect.
 */
export function useServerData(serverId: string): ServerData {
  const { getClient, statuses } = useMatrixClients();
  const status = statuses.get(serverId);

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [worktrees, setWorktrees] = useState<Map<string, WorktreeInfo[]>>(new Map());
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const prevStatusRef = useRef(status);

  /** Full data refresh from server REST APIs */
  const refreshAll = useCallback(async () => {
    const client = getClient(serverId);
    if (!client) return;

    try {
      setLoading(true);
      const [agentList, sessionList, repoList, config] = await Promise.all([
        client.getAgents(),
        client.getSessions(),
        client.getRepositories(),
        client.getServerConfig(),
      ]);

      setAgents(agentList);
      setSessions(sessionList);
      setRepositories(repoList);
      setServerConfig(config);

      // Load worktrees for each repo
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
      setWorktrees(wtMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load server data");
    } finally {
      setLoading(false);
    }
  }, [serverId, getClient]);

  // Full refresh when status changes to "connected"
  useEffect(() => {
    prevStatusRef.current = status;

    if (status === "connected") {
      refreshAll();
    }
  }, [status, refreshAll]);

  // Subscribe to incremental server events
  useEffect(() => {
    const client = getClient(serverId);
    if (!client) return;

    const unsub = client.onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case "server:session_created":
          setSessions((prev) => [...prev, event.session]);
          break;
        case "server:session_closed":
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, status: "closed" }
                : s
            )
          );
          break;
        case "server:session_deleted":
          setSessions((prev) => prev.filter((s) => s.sessionId !== event.sessionId));
          break;
        case "server:session_resumed":
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, status: "active", closeReason: null, suspendedAt: null }
                : s
            )
          );
          break;
        case "server:repository_added":
          setRepositories((prev) => [...prev, event.repository]);
          break;
        case "server:repository_removed":
          setRepositories((prev) => prev.filter((r) => r.id !== event.repositoryId));
          setWorktrees((prev) => {
            const next = new Map(prev);
            next.delete(event.repositoryId);
            return next;
          });
          break;
        case "server:agents_changed":
          setAgents(event.agents);
          break;
      }
    });

    return unsub;
  }, [serverId, getClient]);

  // Visibility change -> full refresh (sleep recovery)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && status === "connected") {
        refreshAll();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [status, refreshAll]);

  return { agents, sessions, repositories, worktrees, serverConfig, loading, error };
}
