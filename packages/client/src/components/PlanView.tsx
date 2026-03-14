import type { PlanEntry } from "@matrix/protocol";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  plan: { entries: PlanEntry[] };
}

function getIcon(status: PlanEntry["status"]) {
  if (status === "completed") return CheckCircle2;
  if (status === "in_progress") return LoaderCircle;
  return Circle;
}

export function PlanView({ plan }: Props) {
  return (
    <Card className="gap-4">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.entries.map((entry, index) => {
          const Icon = getIcon(entry.status);

          return (
            <div key={`${entry.content}-${index}`} className="flex items-start gap-3">
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  entry.status === "completed" && "text-success",
                  entry.status === "in_progress" && "animate-spin text-primary",
                  entry.status === "pending" && "text-muted-foreground",
                )}
              />
              <p
                className={cn(
                  "text-sm leading-6",
                  entry.status === "completed" && "text-foreground",
                  entry.status === "in_progress" && "text-foreground",
                  entry.status === "pending" && "text-muted-foreground",
                )}
              >
                {entry.content}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
