import type { SessionInfo } from "@matrix/protocol";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  session: SessionInfo;
  repositoryName?: string;
  isProcessing: boolean;
  sessionStatus: "active" | "closed";
  statusMessage?: string | null;
}

export function ChatHeader({ session, repositoryName, isProcessing, sessionStatus }: ChatHeaderProps) {
  return (
    <header className="hidden items-center justify-between border-b border-border/50 bg-background px-6 py-3 md:flex">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "size-2 rounded-full",
              sessionStatus === "active" && "bg-success",
              sessionStatus === "closed" && "bg-muted-foreground/40",
            )}
          />
          <h1 className="text-sm font-medium">
            {session.agentId ?? "No agent"}
          </h1>
        </div>
        {session.branch ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {repositoryName && <span>{repositoryName}</span>}
            {repositoryName && <span>/</span>}
            <GitBranch className="size-3" />
            <span>{session.branch}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{session.cwd}</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isProcessing && (
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              <span className="thinking-dot size-1 rounded-full bg-primary" />
              <span className="thinking-dot size-1 rounded-full bg-primary" />
              <span className="thinking-dot size-1 rounded-full bg-primary" />
            </div>
            <span className="text-xs text-muted-foreground">Thinking</span>
          </div>
        )}
      </div>
    </header>
  );
}
