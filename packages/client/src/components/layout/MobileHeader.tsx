import type { SessionInfo } from "@matrix/protocol";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileHeaderProps {
  selectedSession: SessionInfo | null;
  onOpenSidebar: () => void;
}

export function MobileHeader({ selectedSession, onOpenSidebar }: MobileHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <Button size="icon-sm" variant="ghost" onClick={onOpenSidebar}>
          <Menu className="size-5" />
          <span className="sr-only">Open sessions</span>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {selectedSession?.agentId ?? "Sessions"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {selectedSession?.cwd ?? "Choose a session from the drawer"}
          </p>
        </div>
      </div>
    </header>
  );
}
