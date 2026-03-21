import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { MessageSquarePlus, AlertCircle, X } from "lucide-react";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useAllServersData } from "@/hooks/useAllServersData";
import { useServerStore } from "@/hooks/useServerStore";
import { useMatrixClients } from "@/hooks/useMatrixClients";
import { SessionView } from "@/components/chat/SessionView";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import type { ServerInfo } from "@/components/layout/Sidebar";
import { SettingsPage } from "@/pages/SettingsPage";
import { OpenProjectDialog } from "@/components/repository/OpenProjectDialog";
import { CloneFromUrlDialog } from "@/components/repository/CloneFromUrlDialog";
import { NewWorktreeDialog } from "@/components/worktree/NewWorktreeDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Settings } from "lucide-react";

const SESSION_STATUS_ORDER: Record<SessionInfo["status"], number> = {
  active: 0,
  closed: 1,
};

function sortSessions(sessions: SessionInfo[]) {
  return [...sessions].sort((left, right) => {
    const statusDiff = SESSION_STATUS_ORDER[left.status] - SESSION_STATUS_ORDER[right.status];
    if (statusDiff !== 0) return statusDiff;

    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

/** Default server ID for the local sidecar connection */
const SIDECAR_SERVER_ID = "__sidecar__";

export function AppLayout() {
  const { client, status } = useMatrixClient();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [worktrees, setWorktrees] = useState<Map<string, WorktreeInfo[]>>(new Map());
  const [selectedSession, setSelectedSession] = useState<{ serverId: string; sessionId: string } | null>(null);

  // Aggregate sidecar + all remote server data
  const { allSessions, allRepositories, allWorktrees, allAgents, sessionServerMap, repoServerMap, serverDataMap, refreshRemoteServer } = useAllServersData({
    sessions,
    repositories,
    worktrees,
    agents,
  });
  // Backward-compat alias
  const selectedSessionId = selectedSession?.sessionId ?? null;
  const setSelectedSessionId = (id: string | null, serverId?: string) => {
    if (id) {
      setSelectedSession({ serverId: serverId ?? SIDECAR_SERVER_ID, sessionId: id });
    } else {
      setSelectedSession(null);
    }
  };
  // Track intentionally-selected sessions that may not yet appear in allSessions
  // (e.g., after remote worktree creation, before server refresh lands)
  const pendingSessionIdRef = useRef<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [worktreeDialogRepo, setWorktreeDialogRepo] = useState<RepositoryInfo | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloningRepos, setCloningRepos] = useState<Map<string, string>>(new Map()); // jobId → repoName
  const clonePollIntervals = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  // Clean up clone poll intervals on unmount
  useEffect(() => {
    const intervals = clonePollIntervals.current;
    return () => {
      for (const id of intervals) clearInterval(id);
      intervals.clear();
    };
  }, []);

  // Load initial data
  useEffect(() => {
    if (!client) {
      setAgents([]);
      setSessions([]);
      setRepositories([]);
      setWorktrees(new Map());
      setSelectedSessionId(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const [agentItems, sessionItems, repoItems] = await Promise.all([
          client.getAgents(),
          client.getSessions(),
          client.getRepositories(),
        ]);

        if (cancelled) return;

        setLoadError(null);
        setAgents(agentItems);
        setSessions(sessionItems);
        setRepositories(repoItems);

        // Load worktrees for each repo
        const wtMap = new Map<string, WorktreeInfo[]>();
        await Promise.all(
          repoItems.map(async (repo) => {
            try {
              const wts = await client.getWorktrees(repo.id);
              wtMap.set(repo.id, wts);
            } catch {
              wtMap.set(repo.id, []);
            }
          }),
        );

        if (!cancelled) {
          setWorktrees(wtMap);
        }
      } catch (error) {
        console.error("Failed to load layout data:", error);
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : "Failed to load data from server";
          setLoadError(msg === "Failed to fetch" ? "Unable to reach server — check URL and network" : msg);
        }
      }
    };

    void load();

    // Subscribe to sidecar server events for incremental updates
    const unsub = client.onServerEvent((event) => {
      if (cancelled) return;
      switch (event.type) {
        case "server:agents_changed":
          setAgents(event.agents);
          break;
        case "server:session_created":
          setSessions((prev) => [...prev, event.session]);
          break;
        case "server:session_closed":
          setSessions((prev) => prev.filter((s) => s.sessionId !== event.sessionId));
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
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [client, status]);

  // Auto-select session (with same-server priority on fallback)
  useEffect(() => {
    if (allSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (selectedSessionId && allSessions.some((session) => session.sessionId === selectedSessionId)) {
      // Clear pending once the session appears in allSessions
      if (pendingSessionIdRef.current === selectedSessionId) {
        pendingSessionIdRef.current = null;
      }
      return;
    }

    // Don't override a pending selection that hasn't landed in allSessions yet
    if (pendingSessionIdRef.current && pendingSessionIdRef.current === selectedSessionId) {
      return;
    }

    // When selected session is deleted, prefer a session from the same server
    const sorted = sortSessions(allSessions);
    let nextSession: SessionInfo | null = null;

    if (selectedSession?.serverId) {
      const sameServerSessions = sorted.filter(
        (s) => sessionServerMap.get(s.sessionId) === selectedSession.serverId,
      );
      nextSession =
        sameServerSessions.find((s) => s.status !== "closed") ??
        sameServerSessions[0] ??
        null;
    }

    if (!nextSession) {
      nextSession =
        sorted.find((session) => session.status !== "closed") ??
        sorted[0] ??
        null;
    }

    if (!nextSession) {
      return;
    }

    setSelectedSessionId(nextSession.sessionId, sessionServerMap.get(nextSession.sessionId));
  }, [selectedSessionId, selectedSession?.serverId, allSessions, sessionServerMap]);

  const sortedSessions = useMemo(() => sortSessions(allSessions), [allSessions]);
  const selectedSessionInfo = useMemo(
    () => allSessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, allSessions],
  );

  const handleSessionInfoChange = (sessionId: string, patch: Partial<SessionInfo>) => {
    setSessions((previous) =>
      previous.map((session) =>
        session.sessionId === sessionId ? { ...session, ...patch } : session,
      ),
    );
  };

  const handleRefreshSessions = async () => {
    if (!client) return;

    try {
      const sessionItems = await client.getSessions();
      setSessions(sessionItems);
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    }
  };

  const handleRefreshWorktrees = useCallback(async () => {
    if (!client) return;
    const wtMap = new Map<string, WorktreeInfo[]>();
    await Promise.all(
      repositories.map(async (repo) => {
        try {
          const wts = await client.getWorktrees(repo.id);
          wtMap.set(repo.id, wts);
        } catch {
          wtMap.set(repo.id, []);
        }
      }),
    );
    setWorktrees(wtMap);
  }, [client, repositories]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!client) return;

    setSessions((previous) => previous.filter((s) => s.sessionId !== sessionId));

    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
    }

    try {
      await client.deleteSession(sessionId);
    } catch (error) {
      console.error("Failed to delete session:", error);
      void handleRefreshSessions();
    }
  };

  const handleDeleteRepository = async (repositoryId: string, deleteSource: boolean) => {
    if (!client) return;

    const worktreeIds = new Set((worktrees.get(repositoryId) ?? []).map((worktree) => worktree.id));
    const deletedSessionIds = sessions
      .filter(
        (session) =>
          session.repositoryId === repositoryId ||
          (session.worktreeId !== null && worktreeIds.has(session.worktreeId)),
      )
      .map((session) => session.sessionId);

    setRepositories((previous) => previous.filter((repository) => repository.id !== repositoryId));
    setWorktrees((previous) => {
      const next = new Map(previous);
      next.delete(repositoryId);
      return next;
    });
    setSessions((previous) =>
      previous.filter((session) => !deletedSessionIds.includes(session.sessionId)),
    );

    if (selectedSessionId && deletedSessionIds.includes(selectedSessionId)) {
      setSelectedSessionId(null);
    }

    try {
      await client.deleteRepository(repositoryId, deleteSource);
      void handleRefreshSessions();
    } catch (error) {
      console.error("Failed to delete repository:", error);
      const freshRepositories = await client.getRepositories();
      setRepositories(freshRepositories);
      await handleRefreshWorktrees();
      await handleRefreshSessions();
      throw error;
    }
  };

  const handleCreateSession = async (agentId: string, cwd: string) => {
    if (!client) return null;

    const { sessionId } = await client.createSession({ cwd });
    const optimisticSession: SessionInfo = {
      sessionId,
      agentId: null,
      profileId: null,
      cwd,
      createdAt: new Date().toISOString(),
      status: "active",
      recoverable: false,
      agentSessionId: null,
      lastActiveAt: new Date().toISOString(),
      suspendedAt: null,
      closeReason: null,
      worktreeId: null,
      repositoryId: null,
      branch: null,
    };

    setSessions((previous) => {
      const remaining = previous.filter((item) => item.sessionId !== sessionId);
      return [optimisticSession, ...remaining];
    });
    setSelectedSessionId(sessionId);
    setMobileSidebarOpen(false);

    void handleRefreshSessions();

    return sessionId;
  };

  const handleAddRepository = async (path: string, name?: string) => {
    if (!client) return;
    const repo = await client.addRepository({ path, name });
    setRepositories((prev) => {
      if (prev.some((r) => r.id === repo.id)) return prev;
      return [repo, ...prev];
    });
    setWorktrees((prev) => {
      if (prev.has(repo.id)) return prev;
      return new Map(prev).set(repo.id, []);
    });
  };

  const handleCloneStarted = useCallback((jobId: string, repoName: string) => {
    if (!client) return;
    setCloneError(null);
    setCloningRepos((prev) => new Map(prev).set(jobId, repoName));
    // Poll for clone completion
    const poll = setInterval(async () => {
      try {
        const job = await client.getCloneJob(jobId);
        if (job.status === "completed") {
          clearInterval(poll);
          clonePollIntervals.current.delete(poll);
          setCloningRepos((prev) => {
            const next = new Map(prev);
            next.delete(jobId);
            return next;
          });
          // Refresh repositories to pick up the auto-registered repo
          const repos = await client.getRepositories();
          setRepositories(repos);
          const wtMap = new Map<string, WorktreeInfo[]>();
          await Promise.all(
            repos.map(async (repo) => {
              try {
                const wts = await client.getWorktrees(repo.id);
                wtMap.set(repo.id, wts);
              } catch {
                wtMap.set(repo.id, []);
              }
            }),
          );
          setWorktrees(wtMap);
        } else if (job.status === "failed") {
          clearInterval(poll);
          clonePollIntervals.current.delete(poll);
          setCloningRepos((prev) => {
            const next = new Map(prev);
            next.delete(jobId);
            return next;
          });
          setCloneError(job.error || "Clone failed");
        }
      } catch {
        clearInterval(poll);
        clonePollIntervals.current.delete(poll);
        setCloningRepos((prev) => {
          const next = new Map(prev);
          next.delete(jobId);
          return next;
        });
      }
    }, 2000);
    clonePollIntervals.current.add(poll);
  }, [client]);

  const handleCreateWorktree = async (
    repoId: string,
    branch: string,
    baseBranch: string,
  ) => {
    // Route to the server that owns this repo
    const serverId = repoServerMap.get(repoId) ?? SIDECAR_SERVER_ID;
    const targetClient = serverId === SIDECAR_SERVER_ID ? client : getRemoteClient(serverId);
    if (!targetClient) return;

    const result = await targetClient.createWorktree(repoId, {
      branch,
      baseBranch,
    });

    // Refresh data on the owning server
    if (serverId === SIDECAR_SERVER_ID) {
      void handleRefreshWorktrees();
      void handleRefreshSessions();
    } else {
      // Remote servers have no worktree events, so trigger a full refresh
      void refreshRemoteServer(serverId);
    }

    // Select the new session on the correct server
    if (result.sessionId) {
      pendingSessionIdRef.current = result.sessionId;
      setSelectedSessionId(result.sessionId, serverId);
      setMobileSidebarOpen(false);
    }
  };

  const handleDeleteWorktree = async (worktreeId: string) => {
    if (!client) return;
    try {
      await client.deleteWorktree(worktreeId);
      void handleRefreshWorktrees();
      void handleRefreshSessions();
    } catch (error) {
      console.error("Failed to delete worktree:", error);
      throw error;
    }
  };

  // Build server-grouped data for Sidebar
  const { servers: savedServers } = useServerStore();
  const { statuses: multiStatuses, errors: multiErrors, connect: multiConnect, getClient: getRemoteClient } = useMatrixClients();

  const sidebarServers: ServerInfo[] = useMemo(() => {
    const result: ServerInfo[] = [];

    // Sidecar server is always first
    result.push({
      serverId: SIDECAR_SERVER_ID,
      name: "Local",
      status,
      error: null,
      sessions: sortedSessions.filter((s) => sessionServerMap.get(s.sessionId) === SIDECAR_SERVER_ID || !sessionServerMap.has(s.sessionId)),
      repositories,
      worktrees,
      agents,
      cloningRepos,
    });

    // Remote servers
    for (const server of savedServers) {
      const serverData = serverDataMap.get(server.id);
      const serverStatus = multiStatuses.get(server.id) ?? "offline";
      const serverError = multiErrors.get(server.id) ?? null;

      result.push({
        serverId: server.id,
        name: server.name,
        status: serverStatus,
        error: serverError,
        sessions: serverData?.sessions ?? [],
        repositories: serverData?.repositories ?? [],
        worktrees: serverData?.worktrees ?? new Map(),
        agents: serverData?.agents ?? [],
        cloningRepos: new Map(),
      });
    }

    return result;
  }, [status, sortedSessions, sessionServerMap, repositories, worktrees, agents, cloningRepos, savedServers, serverDataMap, multiStatuses, multiErrors]);

  const handleReconnect = useCallback((serverId: string) => {
    const server = savedServers.find((s) => s.id === serverId);
    if (server) {
      multiConnect(serverId, { serverUrl: server.serverUrl, token: server.token });
    }
  }, [savedServers, multiConnect]);

  const sidebarContent = (
    <Sidebar
      servers={sidebarServers}
      selectedSessionId={selectedSessionId}
      onSelectSession={(sessionId, serverId) => {
        setSelectedSessionId(sessionId, serverId);
        setMobileSidebarOpen(false);
      }}
      onCreateSession={handleCreateSession}
      onDeleteSession={handleDeleteSession}
      onOpenProject={() => setShowOpenProject(true)}
      onCloneFromUrl={() => setShowCloneFromUrl(true)}
      onCreateWorktree={(repoId) => {
        const repo = allRepositories.find((r) => r.id === repoId);
        if (repo) setWorktreeDialogRepo(repo);
      }}
      onDeleteWorktree={handleDeleteWorktree}
      onReconnect={handleReconnect}
    />
  );

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {!showSettings && (
        <aside className="hidden h-full w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
          {sidebarContent}
          <div className="border-t border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg text-xs"
              onClick={() => setShowSettings(true)}
              data-testid="settings-btn"
            >
              <Settings className="size-3.5" />
              Settings
            </Button>
          </div>
        </aside>
      )}

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[300px] border-sidebar-border bg-sidebar !gap-0 !p-0" showCloseButton={false}>
          <div className="flex h-full flex-col" style={{ paddingTop: `env(safe-area-inset-top, 0px)`, paddingBottom: `env(safe-area-inset-bottom, 0px)` }}>
            {sidebarContent}
            <div className="border-t border-sidebar-border p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg text-xs"
                onClick={() => {
                  setShowSettings(true);
                  setMobileSidebarOpen(false);
                }}
                data-testid="mobile-settings-btn"
              >
                <Settings className="size-3.5" />
                Settings
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showSettings ? (
          <SettingsPage
            onBack={() => setShowSettings(false)}
            repositories={repositories}
            onDeleteRepository={handleDeleteRepository}
          />
        ) : (
        <>
        {/* Drag region for window dragging when no ChatHeader is visible (empty state) */}
        {!(selectedSession && allSessions.find(s => s.sessionId === selectedSession.sessionId)) && (
          <div data-tauri-drag-region className="hidden h-10 shrink-0 md:block" />
        )}
        <MobileHeader
          selectedSession={selectedSessionInfo}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        {selectedSession && allSessions.find(s => s.sessionId === selectedSession.sessionId) ? (
          <SessionView
            key={selectedSession.sessionId}
            serverId={selectedSession.serverId}
            sessionInfo={allSessions.find(s => s.sessionId === selectedSession.sessionId)!}
            agents={allAgents.get(selectedSession.serverId) ?? []}
            onSessionInfoChange={handleSessionInfoChange}
            onNavigateSettings={() => setShowSettings(true)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-sm space-y-5 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                <MessageSquarePlus className="size-5" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight">No session selected</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Add a repository and create a worktree to get started.
                </p>
              </div>
              <Button
                className="rounded-xl"
                onClick={() => setShowOpenProject(true)}
                variant="outline"
                size="sm"
              >
                Add Repository
              </Button>
            </div>
          </div>
        )}
        </>
        )}
      </main>

      {/* Connection / load error notification */}
      {loadError && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 shadow-lg backdrop-blur">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-destructive">Connection error</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => setLoadError(null)}
            className="shrink-0 rounded-md p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Clone error notification */}
      {cloneError && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 shadow-lg backdrop-blur">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-destructive">Clone failed</p>
            <p className="mt-1 text-muted-foreground">{cloneError}</p>
          </div>
          <button
            type="button"
            onClick={() => setCloneError(null)}
            className="shrink-0 rounded-md p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Dialogs */}
      {showOpenProject && client && (
        <OpenProjectDialog
          client={client}
          onAdd={handleAddRepository}
          onClose={() => setShowOpenProject(false)}
        />
      )}

      {showCloneFromUrl && client && (
        <CloneFromUrlDialog
          client={client}
          onCloneStarted={handleCloneStarted}
          onOpenRepository={() => setShowCloneFromUrl(false)}
          onClose={() => setShowCloneFromUrl(false)}
        />
      )}

      {worktreeDialogRepo && client && (
        <NewWorktreeDialog
          repository={worktreeDialogRepo}
          client={client}
          onCreateWorktree={handleCreateWorktree}
          onClose={() => setWorktreeDialogRepo(null)}
        />
      )}
    </div>
  );
}
