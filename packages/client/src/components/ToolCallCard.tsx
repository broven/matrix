import type { ToolCallStatus, ToolCallLocation, ToolCallContent } from "@matrix/protocol";

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

const statusColors: Record<string, string> = {
  pending: "#f59e0b",
  running: "#3b82f6",
  completed: "#22c55e",
  error: "#ef4444",
};

export function ToolCallCard({ toolCall }: Props) {
  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 8,
      padding: 12,
      margin: "8px 0",
      borderLeft: `4px solid ${statusColors[toolCall.status] || "#9ca3af"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{toolCall.kind || "tool"}: {toolCall.title || toolCall.toolCallId}</span>
        <span style={{ fontSize: 12, color: statusColors[toolCall.status] }}>{toolCall.status}</span>
      </div>
      {toolCall.locations?.map((loc, i) => (
        <div key={i} style={{ fontSize: 13, color: "#6b7280", fontFamily: "monospace" }}>{loc.path}</div>
      ))}
      {toolCall.content?.map((c, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          {c.type === "diff" ? (
            <pre style={{ background: "#f3f4f6", padding: 8, borderRadius: 4, fontSize: 12, overflow: "auto" }}>
              {`--- ${c.path}\n+++ ${c.path}\n- ${c.oldText}\n+ ${c.newText}`}
            </pre>
          ) : (
            <span style={{ fontSize: 13 }}>{c.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}
