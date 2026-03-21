import type { RepositoryInfo } from "@matrix/protocol";
import type { SavedServer } from "../../hooks/useServerStore";
import type { ConnectionStatus } from "@matrix/protocol";
import { cn } from "@/lib/utils";

export type SettingsTab =
  | { kind: "general" }
  | { kind: "server"; serverId: string }
  | { kind: "new-server" }
  | { kind: "repository"; repositoryId: string };

interface SettingsSidebarProps {
  repositories: RepositoryInfo[];
  servers: SavedServer[];
  serverStatuses: Map<string, ConnectionStatus>;
  selectedTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

function StatusDot({ status }: { status: ConnectionStatus | undefined }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting" || status === "reconnecting"
        ? "bg-yellow-500"
        : status === "degraded"
          ? "bg-orange-500"
          : "bg-gray-400";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

export function SettingsSidebar({
  repositories,
  servers,
  serverStatuses,
  selectedTab,
  onSelectTab,
}: SettingsSidebarProps) {
  const isSelected = (tab: SettingsTab) => {
    if (tab.kind !== selectedTab.kind) return false;
    if (tab.kind === "server" && selectedTab.kind === "server") return tab.serverId === selectedTab.serverId;
    if (tab.kind === "repository" && selectedTab.kind === "repository") return tab.repositoryId === selectedTab.repositoryId;
    return true;
  };

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-r border-border bg-muted/20 md:w-[260px]"
      data-testid="settings-sidebar"
    >
      <div className="flex-1 overflow-y-auto p-2">
        {/* General */}
        <button
          className={cn(
            "w-full rounded-md px-3 py-1.5 text-left text-sm",
            isSelected({ kind: "general" }) ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
          onClick={() => onSelectTab({ kind: "general" })}
          data-testid="settings-general-tab"
        >
          General
        </button>

        {/* Servers */}
        <div className="mt-4">
          <span className="px-3 text-xs font-medium text-muted-foreground">Servers</span>
          <div className="mt-1 space-y-0.5">
            {servers.map((server) => (
              <button
                key={server.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm",
                  isSelected({ kind: "server", serverId: server.id })
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onClick={() => onSelectTab({ kind: "server", serverId: server.id })}
                data-testid={`settings-server-tab-${server.id}`}
              >
                <StatusDot status={serverStatuses.get(server.id)} />
                <span className="truncate">{server.name}</span>
              </button>
            ))}
            <button
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/50"
              onClick={() => onSelectTab({ kind: "new-server" })}
              data-testid="settings-add-server-btn"
            >
              Add Server...
            </button>
          </div>
        </div>

        {/* Repositories */}
        {repositories.length > 0 && (
          <div className="mt-4">
            <span className="px-3 text-xs font-medium text-muted-foreground">Repositories</span>
            <div className="mt-1 space-y-0.5">
              {repositories.map((repo) => (
                <button
                  key={repo.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm",
                    isSelected({ kind: "repository", repositoryId: repo.id })
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => onSelectTab({ kind: "repository", repositoryId: repo.id })}
                  data-testid={`settings-repo-tab-${repo.name}`}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium">
                    {repo.name[0]?.toUpperCase()}
                  </span>
                  <span className="truncate">{repo.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
