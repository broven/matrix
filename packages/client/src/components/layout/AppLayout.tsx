import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { MessageSquarePlus, AlertCircle, X } from "lucide-react";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { SessionView } from "@/components/chat/SessionView";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsPage } from "@/pages/SettingsPage";
import { OpenProjectDialog } from "@/components/repository/OpenProjectDialog";
import { CloneFromUrlDialog } from "@/components/repository/CloneFromUrlDialog";
import { NewWorktreeDialog } from "@/components/worktree/NewWorktreeDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Settings } from "lucide-react";

const SESSION_STATUS_ORDER: Record<SessionInfo["status"], number> = {
  active: 0,
  restoring: 1,
  suspended: 2,
  closed: 3,
};

function sortSessions(sessions: SessionInfo[]) {
  return [...sessions].sort((left, right) => {
    const statusDiff = SESSION_STATUS_ORDER[left.status] - SESSION_STATUS_ORDER[right.status];
    if (statusDiff !== 0) return statusDiff;

    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

export function AppLayout() {
  const { client, status } = useMatrixClient();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [worktrees, setWorktrees] = useState<Map<string, WorktreeInfo[]>>(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [worktreeDialogRepo, setWorktreeDialogRepo] = useState<RepositoryInfo | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
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
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [client, status]);

  // Auto-select session
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (selectedSessionId && sessions.some((session) => session.sessionId === selectedSessionId)) {
      return;
    }

    const nextSession =
      sortSessions(sessions).find((session) => session.status !== "closed") ??
      sortSessions(sessions)[0] ??
      null;

    if (!nextSession) {
      return;
    }

    setSelectedSessionId(nextSession.sessionId);
  }, [selectedSessionId, sessions]);

  const sortedSessions = useMemo(() => sortSessions(sessions), [sessions]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
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

  const handleCreateSession = async (agentId: string, cwd: string) => {
    if (!client) return null;

    const session = await client.createSession({ agentId, cwd });
    const optimisticSession: SessionInfo = {
      sessionId: session.sessionId,
      agentId,
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
      const remaining = previous.filter((item) => item.sessionId !== session.sessionId);
      return [optimisticSession, ...remaining];
    });
    setSelectedSessionId(session.sessionId);
    setMobileSidebarOpen(false);

    void handleRefreshSessions();

    return session.sessionId;
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
    agentId: string,
    taskDescription?: string,
  ) => {
    if (!client) return;

    const result = await client.createWorktree(repoId, {
      branch,
      baseBranch,
      agentId,
      taskDescription,
    });

    // Refresh worktrees and sessions
    void handleRefreshWorktrees();
    void handleRefreshSessions();

    // Select the new session
    if (result.session?.sessionId) {
      setSelectedSessionId(result.session.sessionId);
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
    }
  };

  const sidebarContent = (
    <Sidebar
      agents={agents}
      sessions={sortedSessions}
      repositories={repositories}
      worktrees={worktrees}
      cloningRepos={cloningRepos}
      connectionStatus={status}
      selectedSessionId={selectedSessionId}
      onSelectSession={(sessionId) => {
        setSelectedSessionId(sessionId);
        setMobileSidebarOpen(false);
      }}
      onCreateSession={handleCreateSession}
      onDeleteSession={handleDeleteSession}
      onOpenProject={() => setShowOpenProject(true)}
      onCloneFromUrl={() => setShowCloneFromUrl(true)}
      onCreateWorktree={(repoId) => {
        const repo = repositories.find((r) => r.id === repoId);
        if (repo) setWorktreeDialogRepo(repo);
      }}
      onDeleteWorktree={handleDeleteWorktree}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden h-full w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
        {sidebarContent}
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 rounded-lg text-xs"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="size-3.5" />
            Settings
          </Button>
        </div>
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[300px] border-sidebar-border bg-sidebar p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        {showSettings ? (
          <SettingsPage onBack={() => setShowSettings(false)} />
        ) : (
        <>
        <MobileHeader
          selectedSession={selectedSession}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />

        {selectedSession ? (
          <SessionView
            key={selectedSession.sessionId}
            sessionInfo={selectedSession}
            onSessionInfoChange={handleSessionInfoChange}
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
          onClose={() => setShowCloneFromUrl(false)}
        />
      )}

      {worktreeDialogRepo && (
        <NewWorktreeDialog
          repository={worktreeDialogRepo}
          agents={agents}
          onCreateWorktree={handleCreateWorktree}
          onClose={() => setWorktreeDialogRepo(null)}
        />
      )}
    </div>
  );
}
