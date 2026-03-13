import type { PlanEntry } from "@matrix/protocol";

interface Props {
  plan: { entries: PlanEntry[] };
}

const statusIcon: Record<string, string> = {
  completed: "[done]",
  in_progress: "[...]",
  pending: "[ ]",
};

export function PlanView({ plan }: Props) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, margin: "8px 0" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Plan</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {plan.entries.map((entry, i) => (
          <li key={i} style={{
            padding: "4px 0",
            color: entry.status === "completed" ? "#22c55e" : entry.status === "in_progress" ? "#3b82f6" : "#9ca3af",
          }}>
            <span style={{ fontFamily: "monospace", marginRight: 8 }}>{statusIcon[entry.status] || "[ ]"}</span>
            {entry.content}
          </li>
        ))}
      </ul>
    </div>
  );
}
