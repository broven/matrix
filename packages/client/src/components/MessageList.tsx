import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from "@matrix/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PlanView } from "@/components/PlanView";
import { PermissionCard } from "@/components/PermissionCard";
import { ToolCallCard } from "@/components/ToolCallCard";

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

interface RenderableToolCall {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status: ToolCallStatus;
  locations?: ToolCallLocation[];
  content?: ToolCallContent[];
}

type RenderItem =
  | { key: string; kind: "message"; text: string }
  | { key: string; kind: "tool_call"; toolCall: RenderableToolCall }
  | { key: string; kind: "permission_request"; data: Extract<SessionUpdate, { sessionUpdate: "permission_request" }> }
  | { key: string; kind: "plan"; data: Extract<SessionUpdate, { sessionUpdate: "plan" }> };

function isUserMessage(text: string): boolean {
  return text.startsWith("> ");
}

/**
 * Normalize ACP content format to protocol ToolCallContent format.
 * ACP sends: {type: "content", content: {type: "text", text: "..."}}
 * Protocol expects: {type: "text", text: "..."}
 */
function normalizeContent(content?: ToolCallContent[]): ToolCallContent[] | undefined {
  if (!content?.length) return content;
  return content.map((item) => {
    if (item.type === "text" || item.type === "diff") return item;
    // Handle ACP wrapped format: {type: "content", content: {type: "text", text: "..."}}
    const wrapped = item as unknown as { type: string; content?: ToolCallContent };
    if (wrapped.content && typeof wrapped.content === "object") {
      return wrapped.content;
    }
    return item;
  });
}

function mergeToolCall(
  existing: RenderableToolCall | undefined,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
): RenderableToolCall {
  // Pick up content from raw data (ACP sends content on tool_call too)
  const rawContent = normalizeContent((update as unknown as { content?: ToolCallContent[] }).content);

  if (update.sessionUpdate === "tool_call") {
    return {
      toolCallId: update.toolCallId,
      title: update.title,
      kind: update.kind,
      status: update.status,
      locations: update.locations,
      content: rawContent ?? existing?.content,
    };
  }

  return {
    toolCallId: update.toolCallId,
    title: existing?.title,
    kind: existing?.kind,
    status: update.status,
    locations: existing?.locations,
    content: rawContent ?? existing?.content,
  };
}

export function buildRenderItems(events: SessionEvent[]): RenderItem[] {
  const renderItems: RenderItem[] = [];
  const toolCallIndex = new Map<string, number>();

  for (const event of events) {
    switch (event.data.sessionUpdate) {
      case "tool_call":
      case "tool_call_update": {
        const existingIndex = toolCallIndex.get(event.data.toolCallId);
        const existing =
          existingIndex === undefined || renderItems[existingIndex]?.kind !== "tool_call"
            ? undefined
            : renderItems[existingIndex].toolCall;
        const merged = mergeToolCall(existing, event.data);

        if (existingIndex === undefined) {
          toolCallIndex.set(event.data.toolCallId, renderItems.length);
          renderItems.push({
            key: event.id,
            kind: "tool_call",
            toolCall: merged,
          });
        } else {
          renderItems[existingIndex] = {
            key: event.id,
            kind: "tool_call",
            toolCall: merged,
          };
        }
        break;
      }
      case "agent_message_chunk": {
        const text = event.data.content.text;
        const previousItem = renderItems.at(-1);

        if (
          previousItem?.kind === "message" &&
          !isUserMessage(previousItem.text) &&
          !isUserMessage(text)
        ) {
          previousItem.text += text;
          break;
        }

        renderItems.push({ key: event.id, kind: "message", text });
        break;
      }
      case "permission_request":
        renderItems.push({ key: event.id, kind: "permission_request", data: event.data });
        break;
      case "plan":
        renderItems.push({ key: event.id, kind: "plan", data: event.data });
        break;
      default:
        break;
    }
  }

  return renderItems;
}

export function MessageList({ events, onApprove, onReject }: Props) {
  const renderItems = buildRenderItems(events);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 md:px-6 md:py-6">
      {renderItems.map((item) => {
        switch (item.kind) {
          case "message": {
            const isOwnMessage = isUserMessage(item.text);

            if (isOwnMessage) {
              return (
                <div key={item.key} className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl rounded-br-sm bg-primary/10 px-4 py-3 text-sm leading-6 text-foreground shadow-sm dark:bg-primary/20">
                    <p className="whitespace-pre-wrap">{item.text.slice(2)}</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={item.key} className="flex justify-start">
                <div className="markdown-content max-w-[90%] rounded-3xl rounded-bl-sm border bg-card px-4 py-3 text-sm leading-6 shadow-sm md:max-w-[82%]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </div>
              </div>
            );
          }
          case "tool_call":
            return <ToolCallCard key={item.key} toolCall={item.toolCall} />;
          case "permission_request":
            return (
              <PermissionCard
                key={item.key}
                request={item.data}
                onApprove={onApprove}
                onReject={onReject}
              />
            );
          case "plan":
            return <PlanView key={item.key} plan={item.data} />;
        }
      })}
    </div>
  );
}
