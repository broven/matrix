import { cn } from "@/lib/utils";

interface StatusBarProps {
  status: "working" | "idle" | "error" | "suspended" | "closed" | "restoring";
  message?: string | null;
}

export function StatusBar({ status, message }: StatusBarProps) {
  return (
    <div className="border-t border-border bg-background px-4 py-2 md:px-6">
      <div
        className={cn(
          "h-1.5 rounded-full",
          status === "working" && "status-bar-working",
          status === "restoring" && "bg-primary/70",
          status === "idle" && "bg-muted",
          status === "suspended" && "bg-amber-500/70",
          status === "closed" && "bg-slate-500/70",
          status === "error" && "bg-destructive/70",
        )}
      />
      {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
