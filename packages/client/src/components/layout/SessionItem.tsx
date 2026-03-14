import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@matrix/protocol";
import { Clock3, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionItemProps {
  session: SessionInfo;
  selected: boolean;
  onSelect: () => void;
  onDelete: (sessionId: string) => void;
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

export function SessionItem({ session, selected, onSelect, onDelete }: SessionItemProps) {
  const statusMeta = getSessionStatusMeta(session.status);
  const [confirming, setConfirming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setContextMenu({ x, y });
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const triggerDelete = () => {
    setContextMenu(null);
    setConfirming(true);
  };

  const confirmDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirming(false);
    onDelete(session.sessionId);
  };

  const cancelDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div
        ref={itemRef}
        className="flex w-full items-center justify-between rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
      >
        <span className="text-sm font-medium">Delete session?</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
            onClick={confirmDelete}
          >
            Yes
          </button>
          <button
            type="button"
            className="rounded-lg bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/80"
            onClick={cancelDelete}
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
          "group relative flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition-colors",
          selected
            ? "border-primary/40 bg-primary/10 shadow-sm"
            : "border-transparent bg-transparent hover:border-sidebar-border hover:bg-background/75",
        )}
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
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
            <div className="relative mt-1">
              <div className={cn("size-2 rounded-full transition-opacity group-hover:opacity-0 group-focus-within:opacity-0", statusMeta.indicatorClassName)} />
              <div
                role="button"
                tabIndex={0}
                className="absolute inset-0 flex -translate-x-0.5 -translate-y-0.5 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  triggerDelete();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    triggerDelete();
                  }
                }}
                aria-label="Delete session"
              >
                <X className="size-3.5 text-muted-foreground hover:text-destructive" />
              </div>
            </div>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {statusMeta.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="size-3" />
          {formatRelativeTime(session.lastActiveAt || session.createdAt)}
        </div>
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={triggerDelete}
          >
            <X className="size-3.5" />
            Delete
          </button>
        </div>
      ) : null}
    </>
  );
}
