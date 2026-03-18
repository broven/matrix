import type { PlanEntry } from "@matrix/protocol";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
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
    <div className="animate-message-in rounded-xl border border-border/50 bg-card/50 px-4 py-3.5">
      <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Plan</p>
      <div className="space-y-2.5">
        {plan.entries.map((entry, index) => {
          const Icon = getIcon(entry.status);

          return (
            <div key={`${entry.content}-${index}`} className="flex items-start gap-2.5">
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  entry.status === "completed" && "text-success",
                  entry.status === "in_progress" && "animate-spin text-primary",
                  entry.status === "pending" && "text-muted-foreground/40",
                )}
              />
              <p
                className={cn(
                  "text-sm leading-relaxed",
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
      </div>
    </div>
  );
}
