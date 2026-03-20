import type { SessionInfo } from "@matrix/protocol";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileHeaderProps {
  selectedSession: SessionInfo | null;
  onOpenSidebar: () => void;
}

export function MobileHeader({ selectedSession, onOpenSidebar }: MobileHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5 md:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <Button size="icon-sm" variant="ghost" onClick={onOpenSidebar} className="rounded-lg">
          <Menu className="size-5" />
          <span className="sr-only">Open sessions</span>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {selectedSession?.branch ?? selectedSession?.agentId ?? "Sessions"}
          </p>
        </div>
      </div>
    </header>
  );
}
