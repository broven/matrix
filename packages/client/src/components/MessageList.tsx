import type { SessionUpdate } from "@matrix/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { PlanView } from "./PlanView";

export interface SessionEvent {
  id: string;
  type: string;
  data: SessionUpdate;
  timestamp: number;
}

interface Props {
  events: SessionEvent[];
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
}

const markdownStyles = `
.markdown-content p { margin: 0.5em 0; }
.markdown-content pre {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
}
.markdown-content code {
  font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
}
.markdown-content :not(pre) > code {
  background: rgba(127,127,127,0.15);
  padding: 2px 5px;
  border-radius: 3px;
}
.markdown-content table {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}
.markdown-content th, .markdown-content td {
  border: 1px solid #444;
  padding: 6px 10px;
  text-align: left;
}
.markdown-content th {
  background: rgba(127,127,127,0.15);
  font-weight: 600;
}
.markdown-content blockquote {
  border-left: 3px solid #666;
  margin: 0.5em 0;
  padding-left: 12px;
  color: #aaa;
}
.markdown-content ul, .markdown-content ol {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.markdown-content a { color: #7aa2f7; }
`;

export function MessageList({ events, onApprove, onReject }: Props) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      <style>{markdownStyles}</style>
      {events.map((event) => {
        switch (event.data.sessionUpdate) {
          case "agent_message_chunk": {
            const text = event.data.content.text;
            const isUserMessage = text.startsWith("> ");
            if (isUserMessage) {
              return (
                <div key={event.id} style={{ padding: "4px 0", whiteSpace: "pre-wrap" }}>
                  {text}
                </div>
              );
            }
            return (
              <div key={event.id} className="markdown-content" style={{ padding: "4px 0" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
            );
          }
          case "tool_call":
            return <ToolCallCard key={event.id} toolCall={event.data} />;
          case "tool_call_update":
            return <ToolCallCard key={event.id} toolCall={event.data} />;
          case "permission_request":
            return (
              <PermissionCard
                key={event.id}
                request={event.data}
                onApprove={onApprove}
                onReject={onReject}
              />
            );
          case "plan":
            return <PlanView key={event.id} plan={event.data} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
