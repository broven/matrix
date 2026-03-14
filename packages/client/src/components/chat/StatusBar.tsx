import { Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface StatusBarProps {
  status: "working" | "idle" | "error" | "suspended" | "closed" | "restoring";
  message?: string | null;
  onCancel?: () => void;
}

export function StatusBar({ status, message, onCancel }: StatusBarProps) {
  return (
    <div className="border-t border-border bg-background px-4 py-2 md:px-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status === "working" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Thinking...</span>
            </>
          )}
          {status === "restoring" && (
            <span className="text-primary/70">Restoring...</span>
          )}
          {status === "error" && (
            <span className="text-destructive">Error</span>
          )}
          {status === "suspended" && (
            <span className="text-amber-500/70">Suspended</span>
          )}
          {status === "closed" && (
            <span className="text-slate-500/70">Closed</span>
          )}
        </div>

        <div className="flex-1" />

        {status === "working" && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1 px-2 text-xs text-muted-foreground",
              "hover:text-destructive hover:bg-destructive/10",
            )}
            onClick={onCancel}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        )}
      </div>
      {message ? (
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
