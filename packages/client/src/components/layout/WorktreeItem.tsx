import { useEffect, useRef, useState } from "react";
import type { SessionInfo, WorktreeInfo } from "@matrix/protocol";
import { GitBranch, X } from "lucide-react";
import { cn } from "@/lib/utils";

function getWorktreeStatusColor(sessions: SessionInfo[]) {
  if (sessions.some((s) => s.status === "active")) return "bg-success";
  return "bg-muted-foreground/30";
}

export interface WorktreeItemProps {
  worktree: WorktreeInfo;
  sessions: SessionInfo[];
  selected: boolean;
  onSelect: () => void;
  onDelete: (worktreeId: string) => void;
}

export function WorktreeItem({ worktree, sessions, selected, onSelect, onDelete }: WorktreeItemProps) {
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
          "group flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors",
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
        <div
          role="button"
          tabIndex={0}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setConfirming(true);
            }
          }}
          aria-label="Delete worktree"
          data-testid="delete-worktree-btn"
        >
          <X className="size-3.5" />
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
