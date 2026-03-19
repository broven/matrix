import type { RepositoryInfo } from "@matrix/protocol";
import { cn } from "@/lib/utils";

export type SettingsTab =
  | { kind: "general" }
  | { kind: "repository"; repositoryId: string };

interface SettingsSidebarProps {
  repositories: RepositoryInfo[];
  selectedTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

export function SettingsSidebar({ repositories, selectedTab, onSelectTab }: SettingsSidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-border bg-muted/20 md:w-[260px]">
      <div className="flex-1 overflow-y-auto p-3">
        <button
          type="button"
          className={cn(
            "flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            selectedTab.kind === "general"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
          onClick={() => onSelectTab({ kind: "general" })}
        >
          General
        </button>

        <div className="mt-6 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Repositories
        </div>

        <div className="space-y-1">
          {repositories.map((repository) => {
            const isSelected =
              selectedTab.kind === "repository" && selectedTab.repositoryId === repository.id;

            return (
              <button
                key={repository.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onClick={() => onSelectTab({ kind: "repository", repositoryId: repository.id })}
                data-testid={`settings-repo-tab-${repository.name}`}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold uppercase text-foreground">
                  {repository.name.slice(0, 1) || "?"}
                </span>
                <span className="truncate">{repository.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
