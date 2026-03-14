import { useState } from "react";
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

function DiffViewer({ path, oldText, newText }: { path: string; oldText: string; newText: string }) {
  const [expanded, setExpanded] = useState(false);

  const computeDiffLines = () => {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const lines: Array<{ text: string; type: "added" | "removed" | "context" | "header" }> = [];

    lines.push({ text: `--- ${path}`, type: "header" });
    lines.push({ text: `+++ ${path}`, type: "header" });

    // Simple line-by-line diff: walk both arrays
    const maxLen = Math.max(oldLines.length, newLines.length);
    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        lines.push({ text: ` ${oldLines[i]}`, type: "context" });
        i++;
        j++;
      } else {
        // Find how far the mismatch goes — look ahead for resync
        let syncFound = false;
        for (let look = 1; look <= 5 && !syncFound; look++) {
          // Check if old[i] matches new[j+look]
          if (j + look < newLines.length && i < oldLines.length && oldLines[i] === newLines[j + look]) {
            // Lines j..j+look-1 are additions
            for (let k = 0; k < look; k++) {
              lines.push({ text: `+${newLines[j + k]}`, type: "added" });
            }
            j += look;
            syncFound = true;
          }
          // Check if old[i+look] matches new[j]
          if (!syncFound && i + look < oldLines.length && j < newLines.length && oldLines[i + look] === newLines[j]) {
            for (let k = 0; k < look; k++) {
              lines.push({ text: `-${oldLines[i + k]}`, type: "removed" });
            }
            i += look;
            syncFound = true;
          }
        }
        if (!syncFound) {
          if (i < oldLines.length) {
            lines.push({ text: `-${oldLines[i]}`, type: "removed" });
            i++;
          }
          if (j < newLines.length) {
            lines.push({ text: `+${newLines[j]}`, type: "added" });
            j++;
          }
        }
      }
    }

    return lines;
  };

  const diffLines = expanded ? computeDiffLines() : [];

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontFamily: "var(--font-mono, monospace)" }}>{path}</span>
        <button className="diff-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? "\u25BC" : "\u25B6"} View Changes
        </button>
      </div>
      {expanded && (
        <div className="diff-viewer">
          {diffLines.map((line, idx) => {
            let className = "diff-line";
            if (line.type === "added") className += " diff-line--added";
            else if (line.type === "removed") className += " diff-line--removed";
            else if (line.type === "header") className += " diff-line--header";
            return (
              <div key={idx} className={className}>
                {line.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TextContent({ text }: { text: string }) {
  return (
    <pre style={{
      fontSize: 13,
      marginBottom: 8,
      maxHeight: 200,
      overflowY: "auto",
      background: "var(--color-surface, #f8fafc)",
      padding: 8,
      borderRadius: 4,
      border: "1px solid var(--color-border, #e5e7eb)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}>
      {text}
    </pre>
  );
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
      border: "2px solid var(--color-warning, #f59e0b)",
      borderRadius: 8,
      padding: 16,
      margin: "8px 0",
      background: "var(--color-warning-bg, #fffbeb)",
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Permission Required: {request.toolCall.kind} — {request.toolCall.title}
      </div>
      {request.toolCall.content?.map((c, i) =>
        c.type === "diff" ? (
          <DiffViewer key={i} path={c.path} oldText={c.oldText} newText={c.newText} />
        ) : (
          <TextContent key={i} text={c.text} />
        )
      )}
      <div className="permission-actions" style={{ display: "flex", gap: 8 }}>
        {approveOption && (
          <button
            onClick={() => onApprove(request.toolCallId, approveOption.optionId)}
            style={{ padding: "6px 16px", background: "var(--color-success, #22c55e)", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {approveOption.name}
          </button>
        )}
        {rejectOption && (
          <button
            onClick={() => onReject(request.toolCallId, rejectOption.optionId)}
            style={{ padding: "6px 16px", background: "var(--color-danger, #ef4444)", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            {rejectOption.name}
          </button>
        )}
      </div>
    </div>
  );
}
