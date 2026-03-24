import { describe, expect, it } from "vitest";
import { buildRenderItems, type SessionEvent } from "@/components/MessageList";

describe("buildRenderItems", () => {
  it("merges consecutive assistant message chunks into one message item", () => {
    const events: SessionEvent[] = [
      {
        id: "msg-1",
        type: "message",
        timestamp: 1,
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hey" },
        },
      },
      {
        id: "msg-2",
        type: "message",
        timestamp: 2,
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "！what" },
        },
      },
      {
        id: "msg-3",
        type: "message",
        timestamp: 3,
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "can" },
        },
      },
      {
        id: "msg-4",
        type: "message",
        timestamp: 4,
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "i help you with" },
        },
      },
    ];

    const items = buildRenderItems(events);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "message",
      text: "Hey！whatcani help you with",
    });
  });

  it("merges tool call updates into the original tool card", () => {
    const events: SessionEvent[] = [
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 1,
        data: {
          sessionUpdate: "tool_call",
          toolCallId: "abc",
          title: "Write config",
          kind: "edit",
          status: "running",
          locations: [{ path: "src/app.ts" }],
        },
      },
      {
        id: "tool-2",
        type: "tool_call_update",
        timestamp: 2,
        data: {
          sessionUpdate: "tool_call_update",
          toolCallId: "abc",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "src/app.ts",
              oldText: "old",
              newText: "new",
            },
          ],
        },
      },
    ];

    const items = buildRenderItems(events);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool_call",
      toolCall: {
        toolCallId: "abc",
        title: "Write config",
        kind: "edit",
        status: "completed",
        locations: [{ path: "src/app.ts" }],
        content: [
          {
            type: "diff",
            path: "src/app.ts",
            oldText: "old",
            newText: "new",
          },
        ],
      },
    });
  });

  it("preserves diagram code blocks as message items for rendering", () => {
    const events: SessionEvent[] = [
      {
        id: "msg-diagram",
        type: "message",
        timestamp: 1,
        data: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "```mermaid\ngraph TD\n  A --> B\n```" },
        },
      },
    ];

    const items = buildRenderItems(events);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "message",
      text: "```mermaid\ngraph TD\n  A --> B\n```",
    });
  });
});
