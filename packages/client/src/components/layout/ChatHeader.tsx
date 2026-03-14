import type { SessionInfo } from "@matrix/protocol";
import { FolderRoot, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ChatHeaderProps {
  session: SessionInfo;
  isProcessing: boolean;
  sessionStatus: SessionInfo["status"];
  statusMessage?: string | null;
}

function getStatusBadge(sessionStatus: SessionInfo["status"]) {
  switch (sessionStatus) {
    case "active":
      return { variant: "secondary" as const, label: "Active" };
    case "restoring":
      return { variant: "default" as const, label: "Restoring" };
    case "suspended":
      return { variant: "outline" as const, label: "Suspended" };
    case "closed":
      return { variant: "outline" as const, label: "Closed" };
  }
}

export function ChatHeader({ session, isProcessing, sessionStatus, statusMessage }: ChatHeaderProps) {
  const sessionBadge = getStatusBadge(sessionStatus);

  return (
    <header className="hidden border-b border-border bg-background/90 px-6 py-4 backdrop-blur md:flex md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-full px-2.5 py-0.5">
            Session
          </Badge>
          <Badge variant={sessionBadge.variant} className="rounded-full px-2.5 py-0.5">
            {sessionBadge.label}
          </Badge>
          <h1 className="text-lg font-semibold tracking-tight">{session.agentId}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderRoot className="size-4" />
          <span className="truncate">{session.cwd}</span>
        </div>
        {statusMessage ? (
          <p className="max-w-2xl text-xs text-muted-foreground">{statusMessage}</p>
        ) : null}
      </div>
      <Badge
        variant={isProcessing || sessionStatus === "restoring" ? "default" : "secondary"}
        className="rounded-full px-3 py-1"
      >
        <Radio className="mr-1 size-3.5" />
        {sessionStatus === "restoring" ? "Restoring" : isProcessing ? "Working" : "Idle"}
      </Badge>
    </header>
  );
}
