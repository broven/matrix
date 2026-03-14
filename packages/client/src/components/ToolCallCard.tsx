import { useState } from "react";
import type { ToolCallContent, ToolCallLocation, ToolCallStatus } from "@matrix/protocol";
import { ChevronDown, WandSparkles } from "lucide-react";
import { ToolContentList } from "@/components/ToolContent";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

const statusVariant: Record<ToolCallStatus, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  error: "destructive",
};

export function ToolCallCard({ toolCall }: Props) {
  const [open, setOpen] = useState(Boolean(toolCall.content?.length));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 overflow-hidden py-0">
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <WandSparkles className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant[toolCall.status]}>
                    {toolCall.status}
                  </Badge>
                  <span className="truncate text-sm font-medium">
                    {toolCall.kind ?? "tool"}: {toolCall.title ?? toolCall.toolCallId}
                  </span>
                </div>
                {toolCall.locations?.length ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {toolCall.locations.map((location) => (
                      <code
                        key={location.path}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {location.path}
                      </code>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <ChevronDown
              className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-4 py-4">
          <ToolContentList content={toolCall.content} />
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
