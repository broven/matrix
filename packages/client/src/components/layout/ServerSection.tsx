import { useMemo, useState } from "react";
import type { AgentListItem, ConnectionStatus, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Plus, ChevronRight, ChevronDown, FolderGit2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionItem } from "@/components/layout/SessionItem";
import { WorktreeItem } from "@/components/layout/WorktreeItem";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface ServerSectionProps {
  serverId: string;
  serverName: string;
  status: ConnectionStatus;
  error: string | null;
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  sessions: SessionInfo[];
  agents: AgentListItem[];
  cloningRepos: Map<string, string>;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (agentId: string, cwd: string) => Promise<string | null>;
  onDeleteSession: (sessionId: string) => void;
  onCreateWorktree: (repoId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onReconnect: () => void;
  query: string;
}

function getStatusDotColor(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-success";
    case "connecting":
    case "reconnecting":
      return "bg-warning";
    case "degraded":
      return "bg-warning";
    case "offline":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

export function ServerSection({
  serverId,
  serverName,
  status,
  error,
  repositories,
  worktrees,
  sessions,
  cloningRepos,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  onCreateWorktree,
  onDeleteWorktree,
  onReconnect,
  query,
}: ServerSectionProps) {
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set());

  // Sessions grouped by worktree
  const sessionsByWorktree = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      if (session.worktreeId) {
        const list = map.get(session.worktreeId) ?? [];
        list.push(session);
        map.set(session.worktreeId, list);
      }
    }
    return map;
  }, [sessions]);

  // Legacy sessions (no worktreeId)
  const legacySessions = useMemo(
    () => sessions.filter((s) => !s.worktreeId),
    [sessions],
  );

  const toggleRepo = (repoId: string) => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  };

  const isRepoExpanded = (repoId: string) => !collapsedRepos.has(repoId);

  const isOffline = status === "offline";

  return (
    <div data-testid={`server-section-${serverId}`} className="space-y-1">
      {/* Server header */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <div
          className={cn("size-2 shrink-0 rounded-full", getStatusDotColor(status))}
          title={status}
          data-testid="server-status-dot"
        />
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground truncate">
          {serverName}
        </span>
      </div>

      {/* Error / offline message */}
      {isOffline && error && (
        <div className="mx-2 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
          <span className="flex-1 truncate text-xs text-destructive/80">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={onReconnect}
            data-testid="server-reconnect-btn"
          >
            <RefreshCw className="size-3" />
            Reconnect
          </Button>
        </div>
      )}

      {/* Cloning repositories */}
      {Array.from(cloningRepos.entries()).map(([jobId, repoName]) => (
        <div key={jobId} className="flex items-center gap-2 rounded-lg px-3 py-2.5">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-muted-foreground">{repoName}</span>
          <span className="ml-auto text-xs text-muted-foreground/60">Cloning...</span>
        </div>
      ))}

      {/* Repositories with worktrees */}
      {repositories.map((repo) => {
        const repoWorktrees = worktrees.get(repo.id) ?? [];
        const isExpanded = isRepoExpanded(repo.id);

        // Filter by query
        if (query) {
          const q = query.toLowerCase();
          const matchesRepo = repo.name.toLowerCase().includes(q);
          const matchesWorktree = repoWorktrees.some((wt) => wt.branch.toLowerCase().includes(q));
          if (!matchesRepo && !matchesWorktree) return null;
        }

        return (
          <Collapsible key={repo.id} open={isExpanded} onOpenChange={() => toggleRepo(repo.id)}>
            <div className="group flex items-center gap-1 rounded-lg px-1 py-1" data-testid={`repo-item-${repo.name}`}>
              <CollapsibleTrigger className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent/50">
                {isExpanded ? (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                )}
                <FolderGit2 className="size-3.5 text-muted-foreground" />
                <span className="truncate">{repo.name}</span>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateWorktree(repo.id);
                }}
                title="New worktree"
                data-testid="new-session-btn"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            <CollapsibleContent>
              <div className="ml-4 min-w-0 space-y-0.5 border-l border-border/40 pl-2">
                {repoWorktrees.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground/60">
                    No worktrees
                  </div>
                ) : (
                  repoWorktrees.map((wt) => {
                    const wtSessions = sessionsByWorktree.get(wt.id) ?? [];
                    const activeSession = wtSessions.find((s) => s.status !== "closed");
                    const isSelected = activeSession?.sessionId === selectedSessionId;

                    return (
                      <WorktreeItem
                        key={wt.id}
                        worktree={wt}
                        sessions={wtSessions}
                        selected={isSelected}
                        onSelect={() => {
                          if (activeSession) onSelectSession(activeSession.sessionId);
                        }}
                        onDelete={onDeleteWorktree}
                      />
                    );
                  })
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Legacy sessions (no worktree) */}
      {legacySessions.length > 0 && (
        <>
          {repositories.length > 0 && (
            <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Sessions
            </div>
          )}
          {legacySessions
            .filter((session) => {
              if (!query) return true;
              const q = query.toLowerCase();
              return (
                (session.agentId ?? "").toLowerCase().includes(q) ||
                session.cwd.toLowerCase().includes(q)
              );
            })
            .map((session) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                selected={session.sessionId === selectedSessionId}
                onSelect={() => onSelectSession(session.sessionId)}
                onDelete={onDeleteSession}
              />
            ))}
        </>
      )}

      {repositories.length === 0 && legacySessions.length === 0 && cloningRepos.size === 0 && (
        <div className="px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground/60">No repositories</p>
        </div>
      )}
    </div>
  );
}
