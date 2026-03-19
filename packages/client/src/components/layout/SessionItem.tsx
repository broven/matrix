import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@matrix/protocol";
import { X } from "lucide-react";
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

function getStatusColor(status: SessionInfo["status"]) {
  switch (status) {
    case "active":
      return "bg-success";
    case "restoring":
      return "bg-primary animate-pulse";
    case "suspended":
      return "bg-amber-400";
    case "closed":
      return "bg-muted-foreground/30";
  }
}

export function SessionItem({ session, selected, onSelect, onDelete }: SessionItemProps) {
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
        className="flex w-full items-center justify-between rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5"
      >
        <span className="text-sm font-medium">Delete?</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
            onClick={confirmDelete}
            data-testid="confirm-delete-btn"
          >
            Yes
          </button>
          <button
            type="button"
            className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/80"
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
          "group relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          selected
            ? "bg-accent"
            : "hover:bg-accent/50",
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
        <div className={cn("size-2 shrink-0 rounded-full", getStatusColor(session.status))} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session.agentId}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatRelativeTime(session.lastActiveAt || session.createdAt)}
          </p>
        </div>
        <div
          role="button"
          tabIndex={0}
          className="flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10"
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

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
            onClick={triggerDelete}
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
