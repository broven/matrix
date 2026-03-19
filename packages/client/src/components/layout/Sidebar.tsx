import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem, ConnectionStatus, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Plus, Search, ChevronRight, ChevronDown, GitBranch, FolderGit2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionItem } from "@/components/layout/SessionItem";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AddRepositoryMenu } from "@/components/repository/AddRepositoryMenu";

interface SidebarProps {
  agents: AgentListItem[];
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  cloningRepos: Map<string, string>;
  connectionStatus: ConnectionStatus;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (agentId: string, cwd: string) => Promise<string | null>;
  onDeleteSession: (sessionId: string) => void;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onCreateWorktree: (repoId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
}

function getWorktreeStatusColor(sessions: SessionInfo[]) {
  if (sessions.some((s) => s.status === "active")) return "bg-success";
  if (sessions.some((s) => s.status === "restoring")) return "bg-primary animate-pulse";
  if (sessions.some((s) => s.status === "suspended")) return "bg-amber-400";
  return "bg-muted-foreground/30";
}

interface WorktreeItemProps {
  worktree: WorktreeInfo;
  sessions: SessionInfo[];
  selected: boolean;
  onSelect: () => void;
  onDelete: (worktreeId: string) => void;
}

function WorktreeItem({ worktree, sessions, selected, onSelect, onDelete }: WorktreeItemProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find((s) => s.status !== "closed");

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextMenu]);

  useEffect(() => {
    if (!confirming) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (itemRef.current && !itemRef.current.contains(event.target as Node)) {
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  if (confirming) {
    return (
      <div
        ref={itemRef}
        className="flex w-full items-center justify-between rounded-lg border border-destructive/30 bg-destructive/8 px-2.5 py-2"
      >
        <span className="text-sm font-medium">Delete?</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
              onDelete(worktree.id);
            }}
            data-testid="confirm-delete-btn"
          >
            Yes
          </button>
          <button
            type="button"
            className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/80"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/50",
        )}
        data-testid={`worktree-item-${worktree.branch}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (activeSession) onSelect();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && activeSession) {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <div className={cn("size-2 shrink-0 rounded-full", getWorktreeStatusColor(sessions))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <GitBranch className="size-3 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{worktree.branch}</p>
          </div>
          {activeSession && (
            <p className="truncate text-xs text-muted-foreground">
              {activeSession.agentId}
            </p>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => {
              setContextMenu(null);
              setConfirming(true);
            }}
            data-testid="delete-repo-option"
          >
            <X className="size-3.5" />
            Delete
          </button>
        </div>
      )}
    </>
  );
}

export function Sidebar({
  agents,
  sessions,
  repositories,
  worktrees,
  cloningRepos,
  connectionStatus,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onOpenProject,
  onCloneFromUrl,
  onCreateWorktree,
  onDeleteWorktree,
}: SidebarProps) {
  const [query, setQuery] = useState("");
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

  const totalItems = repositories.length + legacySessions.length + cloningRepos.size;

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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="space-y-4 px-4 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
              <span className="text-sm font-bold">M</span>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Matrix</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Workspace
              </div>
            </div>
          </div>
          <div
            className={cn(
              "size-2 rounded-full",
              connectionStatus === "connected" ? "bg-success" : "bg-muted-foreground/40",
            )}
            title={connectionStatus}
            data-testid={connectionStatus === "connected" ? "connection-status-connected" : undefined}
          />
        </div>

        {totalItems > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search..."
              className="h-8 rounded-lg border-border/50 bg-background pl-8 text-sm"
            />
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="space-y-1 pb-4">
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
                  <div className="ml-4 space-y-0.5 border-l border-border/40 pl-2">
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
                    session.agentId.toLowerCase().includes(q) ||
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
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No repositories</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Add a repository to get started.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t border-sidebar-border px-4 py-4">
        <AddRepositoryMenu
          onOpenProject={onOpenProject}
          onCloneFromUrl={onCloneFromUrl}
        />
      </div>
    </div>
  );
}
