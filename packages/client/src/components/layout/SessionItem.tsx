import type { SessionInfo } from "@matrix/protocol";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionItemProps {
  session: SessionInfo;
  selected: boolean;
  onSelect: () => void;
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Unknown";

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getSessionStatusMeta(status: SessionInfo["status"]) {
  switch (status) {
    case "active":
      return {
        label: "Active",
        indicatorClassName:
          "bg-success shadow-[0_0_0_4px_color-mix(in_oklch,var(--success)_18%,transparent)]",
      };
    case "restoring":
      return {
        label: "Restoring",
        indicatorClassName:
          "bg-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]",
      };
    case "suspended":
      return {
        label: "Suspended",
        indicatorClassName:
          "bg-amber-500 shadow-[0_0_0_4px_color-mix(in_oklch,oklch(76.9%_0.188_70.08)_18%,transparent)]",
      };
    case "closed":
      return {
        label: "Closed",
        indicatorClassName:
          "bg-slate-400 shadow-[0_0_0_4px_color-mix(in_oklch,oklch(70.4%_0.04_256.788)_18%,transparent)]",
      };
  }
}

export function SessionItem({ session, selected, onSelect }: SessionItemProps) {
  const statusMeta = getSessionStatusMeta(session.status);

  return (
    <button
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10 shadow-sm"
          : "border-transparent bg-transparent hover:border-sidebar-border hover:bg-background/75",
      )}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "absolute inset-y-3 left-1 w-1 rounded-full transition-colors",
          selected ? "bg-primary" : "bg-transparent group-hover:bg-border",
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{session.agentId}</p>
          <p className="truncate text-xs text-muted-foreground">{session.cwd}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={cn("mt-1 size-2 rounded-full", statusMeta.indicatorClassName)} />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {statusMeta.label}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock3 className="size-3" />
        {formatRelativeTime(session.lastActiveAt || session.createdAt)}
      </div>
    </button>
  );
}
