import { useState } from "react";
import type { PermissionOptionKind, ToolCallContent, ToolCallStatus, ToolKind } from "@matrix/protocol";
import { ShieldAlert } from "lucide-react";
import { ToolContentList } from "@/components/ToolContent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  request: {
    toolCallId: string;
    toolCall: {
      title: string;
      kind: ToolKind;
      status: ToolCallStatus;
      content?: ToolCallContent[];
    };
    options: Array<{
      optionId: string;
      name: string;
      kind: PermissionOptionKind;
    }>;
  };
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
}

function getButtonVariant(kind: PermissionOptionKind) {
  if (kind === "allow_always") return "default";
  if (kind === "allow_once") return "outline";
  return "destructive";
}

export function PermissionCard({ request, onApprove, onReject }: Props) {
  const [resolution, setResolution] = useState<string | null>(null);

  return (
    <Alert className="gap-y-3 border-amber-500/40 bg-amber-500/10 text-foreground">
      <ShieldAlert className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>
        Permission Required: {request.toolCall.kind} - {request.toolCall.title}
      </AlertTitle>
      <AlertDescription className="w-full gap-3">
        {resolution ? (
          <div className="rounded-lg border border-amber-500/30 bg-background/70 px-3 py-2 text-sm">
            {resolution}
          </div>
        ) : (
          <>
            <ToolContentList content={request.toolCall.content} />
            <div className="flex flex-wrap gap-2 pt-1">
              {request.options.map((option) => {
                const action =
                  option.kind === "allow_always" || option.kind === "allow_once"
                    ? onApprove
                    : onReject;

                return (
                  <Button
                    key={option.optionId}
                    type="button"
                    variant={getButtonVariant(option.kind)}
                    onClick={() => {
                      action(request.toolCallId, option.optionId);
                      setResolution(
                        option.kind === "allow_always" || option.kind === "allow_once"
                          ? `Allowed: ${option.name}`
                          : `Denied: ${option.name}`,
                      );
                    }}
                  >
                    {option.name}
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}
