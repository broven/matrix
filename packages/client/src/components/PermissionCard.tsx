import type { PermissionOption, ToolCallContent, ToolKind, ToolCallStatus } from "@matrix/protocol";

interface Props {
  request: {
    toolCallId: string;
    toolCall: {
      title: string;
      kind: ToolKind;
      status: ToolCallStatus;
      content?: ToolCallContent[];
    };
    options: PermissionOption[];
  };
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
}

export function PermissionCard({ request, onApprove, onReject }: Props) {
  const approveOption = request.options.find(
    (o) => o.kind === "allow_once" || o.kind === "allow_always"
  );
  const rejectOption = request.options.find(
    (o) => o.kind === "reject_once" || o.kind === "reject_always"
  );

  return (
    <div style={{
      border: "2px solid #f59e0b",
      borderRadius: 8,
      padding: 16,
      margin: "8px 0",
      background: "#fffbeb",
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Permission Required: {request.toolCall.kind} — {request.toolCall.title}
      </div>
      {request.toolCall.content?.map((c, i) => (
        <div key={i} style={{ fontSize: 13, marginBottom: 8 }}>
          {c.type === "text" ? c.text : `diff: ${c.path}`}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        {approveOption && (
          <button
            onClick={() => onApprove(request.toolCallId, approveOption.optionId)}
            style={{ padding: "6px 16px", background: "#22c55e", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {approveOption.name}
          </button>
        )}
        {rejectOption && (
          <button
            onClick={() => onReject(request.toolCallId, rejectOption.optionId)}
            style={{ padding: "6px 16px", background: "#ef4444", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {rejectOption.name}
          </button>
        )}
      </div>
    </div>
  );
}
