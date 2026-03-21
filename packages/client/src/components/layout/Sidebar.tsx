import { useState } from "react";
import type { AgentListItem, ConnectionStatus, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AddRepositoryMenu } from "@/components/repository/AddRepositoryMenu";
import { ServerSection } from "@/components/layout/ServerSection";

export interface ServerInfo {
  serverId: string;
  name: string;
  status: ConnectionStatus;
  error: string | null;
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  agents: AgentListItem[];
  cloningRepos: Map<string, string>;
}

export interface SidebarProps {
  servers: ServerInfo[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, serverId: string) => void;
  onCreateSession: (agentId: string, cwd: string) => Promise<string | null>;
  onDeleteSession: (sessionId: string) => void;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onCreateWorktree: (repoId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onReconnect: (serverId: string) => void;
}

export function Sidebar({
  servers,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onOpenProject,
  onCloneFromUrl,
  onCreateWorktree,
  onDeleteWorktree,
  onReconnect,
}: SidebarProps) {
  const [query, setQuery] = useState("");

  // Compute total items across all servers for search threshold
  const totalItems = servers.reduce((acc, s) => {
    const legacySessions = s.sessions.filter((sess) => !sess.worktreeId).length;
    return acc + s.repositories.length + legacySessions + s.cloningRepos.size;
  }, 0);

  // Overall connection status: use best status across servers
  const overallStatus: ConnectionStatus = servers.some((s) => s.status === "connected")
    ? "connected"
    : servers.some((s) => s.status === "connecting" || s.status === "reconnecting")
      ? "connecting"
      : "offline";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div data-tauri-drag-region className="space-y-4 px-4 pb-4 pt-5 md:pt-10">
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
              overallStatus === "connected" ? "bg-success" : "bg-muted-foreground/40",
            )}
            title={overallStatus}
            data-testid={overallStatus === "connected" ? "connection-status-connected" : undefined}
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
        <div className="space-y-3 pb-4">
          {servers.map((server) => (
            <ServerSection
              key={server.serverId}
              serverId={server.serverId}
              serverName={server.name}
              status={server.status}
              error={server.error}
              repositories={server.repositories}
              worktrees={server.worktrees}
              sessions={server.sessions}
              agents={server.agents}
              cloningRepos={server.cloningRepos}
              selectedSessionId={selectedSessionId}
              onSelectSession={(sessionId) => onSelectSession(sessionId, server.serverId)}
              onCreateSession={onCreateSession}
              onDeleteSession={onDeleteSession}
              onCreateWorktree={onCreateWorktree}
              onDeleteWorktree={onDeleteWorktree}
              onReconnect={() => onReconnect(server.serverId)}
              query={query}
            />
          ))}

          {servers.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No servers configured</p>
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
