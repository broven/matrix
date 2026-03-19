import { useState } from "react";
import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from "@matrix/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, Copy, Check, RotateCcw } from "lucide-react";
import { PlanView } from "@/components/PlanView";
import { PermissionCard } from "@/components/PermissionCard";
import { ToolCallCard } from "@/components/ToolCallCard";
import { cn } from "@/lib/utils";

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
  | { key: string; kind: "message"; text: string; timestamp?: number }
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

        renderItems.push({ key: event.id, kind: "message", text, timestamp: event.timestamp });
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

function formatElapsed(timestamp?: number) {
  if (!timestamp) return null;
  const elapsed = Math.round((Date.now() - timestamp) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
      aria-label="Copy message"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Group consecutive tool calls into a collapsible cluster */
function ToolCallCluster({ items, allItems }: { items: RenderItem[]; allItems: RenderItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const toolCalls = items.filter((i) => i.kind === "tool_call");
  const messages = items.filter((i) => i.kind === "message");

  const summary = [
    toolCalls.length > 0 && `${toolCalls.length} tool call${toolCalls.length > 1 ? "s" : ""}`,
    messages.length > 0 && `${messages.length} message${messages.length > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="animate-message-in">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span>{summary}</span>
        {!expanded && (
          <span className="font-mono text-xs text-muted-foreground/50">&gt;_</span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 space-y-3 border-l-2 border-border pl-4">
          {items.map((item) => {
            if (item.kind === "tool_call") {
              return <ToolCallCard key={item.key} toolCall={item.toolCall} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

export function MessageList({ events, onApprove, onReject }: Props) {
  const renderItems = buildRenderItems(events);

  // Group consecutive tool calls together
  const groupedItems: Array<{ type: "single"; item: RenderItem } | { type: "cluster"; items: RenderItem[] }> = [];

  for (const item of renderItems) {
    if (item.kind === "tool_call") {
      const lastGroup = groupedItems.at(-1);
      if (lastGroup?.type === "cluster") {
        lastGroup.items.push(item);
      } else {
        groupedItems.push({ type: "cluster", items: [item] });
      }
    } else {
      groupedItems.push({ type: "single", item });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
      {groupedItems.map((group, index) => {
        if (group.type === "cluster") {
          return (
            <ToolCallCluster
              key={group.items[0].key}
              items={group.items}
              allItems={renderItems}
            />
          );
        }

        const item = group.item;

        switch (item.kind) {
          case "message": {
            const isOwnMessage = isUserMessage(item.text);

            if (isOwnMessage) {
              return (
                <div key={item.key} className="flex justify-end animate-message-in">
                  <div className="max-w-[80%] rounded-[1.25rem] rounded-br-md bg-user-bubble px-4 py-2.5 text-[0.9375rem] leading-relaxed text-user-bubble-foreground">
                    <p className="whitespace-pre-wrap">{item.text.slice(2)}</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={item.key} className="group/msg animate-message-in">
                <div className="markdown-content max-w-none text-[0.9375rem] leading-[1.7]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                </div>
                <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                  {item.timestamp && (
                    <span className="mr-1 text-xs text-muted-foreground/50">
                      {formatElapsed(item.timestamp)}
                    </span>
                  )}
                  <CopyButton text={item.text} />
                </div>
              </div>
            );
          }
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
