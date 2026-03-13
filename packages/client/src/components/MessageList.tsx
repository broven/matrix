import type { SessionUpdate } from "@matrix/protocol";
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

export function MessageList({ events, onApprove, onReject }: Props) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      {events.map((event) => {
        switch (event.data.sessionUpdate) {
          case "agent_message_chunk":
            return (
              <div key={event.id} style={{ padding: "4px 0", whiteSpace: "pre-wrap" }}>
                {event.data.content.text}
              </div>
            );
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
