import { Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  status: "working" | "idle" | "error" | "suspended" | "closed" | "restoring";
  message?: string | null;
  onCancel?: () => void;
}

export function StatusBar({ status, message, onCancel }: StatusBarProps) {
  // Hide when idle
  if (status === "idle") return null;

  return (
    <div className="px-4 md:px-6">
      <div className="mx-auto flex max-w-3xl items-center gap-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status === "working" && (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                <span className="thinking-dot size-1 rounded-full bg-primary" />
                <span className="thinking-dot size-1 rounded-full bg-primary" />
                <span className="thinking-dot size-1 rounded-full bg-primary" />
              </div>
              <span>Thinking...</span>
            </div>
          )}
          {status === "restoring" && (
            <span className="text-primary/70">Restoring session...</span>
          )}
          {status === "error" && (
            <span className="text-destructive">{message ?? "Error"}</span>
          )}
          {status === "suspended" && (
            <span className="text-amber-500/80">{message ?? "Session suspended"}</span>
          )}
          {status === "closed" && (
            <span className="text-muted-foreground/60">{message ?? "Session closed"}</span>
          )}
        </div>

        <div className="flex-1" />

        {status === "working" && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors",
              "hover:bg-destructive/10 hover:text-destructive",
            )}
          >
            <Square className="size-3" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
