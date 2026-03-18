import { useState } from "react";
import type { ToolCallContent, ToolCallLocation, ToolCallStatus } from "@matrix/protocol";
import { ChevronRight, Terminal } from "lucide-react";
import { ToolContentList } from "@/components/ToolContent";
import { cn } from "@/lib/utils";

interface Props {
  toolCall: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status: ToolCallStatus;
    locations?: ToolCallLocation[];
    content?: ToolCallContent[];
  };
}

const statusColors: Record<ToolCallStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  completed: "text-success",
  error: "text-destructive",
};

export function ToolCallCard({ toolCall }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30"
      >
        <Terminal className={cn("size-4 shrink-0", statusColors[toolCall.status])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {toolCall.title ?? toolCall.toolCallId}
            </span>
            <span className={cn("text-xs", statusColors[toolCall.status])}>
              {toolCall.status}
            </span>
          </div>
          {toolCall.locations?.length ? (
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {toolCall.locations.map((location) => (
                <code
                  key={location.path}
                  className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {location.path}
                </code>
              ))}
            </div>
          ) : null}
        </div>
        <ChevronRight
          className={cn("size-3.5 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && toolCall.content?.length ? (
        <div className="border-t border-border/40 px-3.5 py-3">
          <ToolContentList content={toolCall.content} />
        </div>
      ) : null}
    </div>
  );
}
