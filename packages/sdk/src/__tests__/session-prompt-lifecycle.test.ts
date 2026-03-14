import { describe, it, expect, vi } from "vitest";
import { MatrixSession } from "../session.js";
import type { Transport } from "../transport/index.js";

function createMockTransport(): Transport & { sentMessages: unknown[] } {
  const sentMessages: unknown[] = [];
  return {
    type: "websocket",
    sentMessages,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getLastEventId: () => undefined,
    send(message: unknown) {
      sentMessages.push(message);
    },
  };
}

describe("MatrixSession prompt lifecycle", () => {
  it("prompt sends subscribe and prompt messages", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());

    session.prompt("hello", { onMessage: vi.fn() });

    // Should send subscribe first, then prompt
    expect(transport.sentMessages).toHaveLength(2);
    expect(transport.sentMessages[0]).toEqual({
      type: "session:subscribe",
      sessionId: "sess_1",
      lastEventId: undefined,
    });
    expect(transport.sentMessages[1]).toEqual({
      type: "session:prompt",
      sessionId: "sess_1",
      prompt: [{ type: "text", text: "hello" }],
    });
  });

  it("onMessage callback fires for agent_message_chunk updates", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onMessage = vi.fn();

    session.prompt("test", { onMessage });

    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "response chunk 1" },
    });
    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "response chunk 2" },
    });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith({ type: "text", text: "response chunk 1" });
    expect(onMessage).toHaveBeenCalledWith({ type: "text", text: "response chunk 2" });
  });

  it("onToolCall callback fires for tool_call updates", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onToolCall = vi.fn();

    session.prompt("do something", { onToolCall });

    const toolCallUpdate = {
      sessionUpdate: "tool_call" as const,
      toolCallId: "tc_1",
      title: "Read file",
      kind: "read" as const,
      status: "running" as const,
    };
    session.handleUpdate(toolCallUpdate);

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(toolCallUpdate);
  });

  it("onToolCallUpdate callback fires for tool_call_update updates", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onToolCallUpdate = vi.fn();

    session.prompt("do something", { onToolCallUpdate });

    const update = {
      sessionUpdate: "tool_call_update" as const,
      toolCallId: "tc_1",
      status: "completed" as const,
      content: [{ type: "text" as const, text: "file contents" }],
    };
    session.handleUpdate(update);

    expect(onToolCallUpdate).toHaveBeenCalledTimes(1);
    expect(onToolCallUpdate).toHaveBeenCalledWith(update);
  });

  it("onPermissionRequest callback fires for permission_request updates", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onPermissionRequest = vi.fn();

    session.prompt("do something", { onPermissionRequest });

    const permReq = {
      sessionUpdate: "permission_request" as const,
      toolCallId: "tc_1",
      toolCall: {
        toolCallId: "tc_1",
        title: "Write file",
        kind: "edit" as const,
        status: "pending" as const,
      },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" as const },
      ],
    };
    session.handleUpdate(permReq);

    expect(onPermissionRequest).toHaveBeenCalledTimes(1);
    expect(onPermissionRequest).toHaveBeenCalledWith(permReq);
  });

  it("onPlan callback fires for plan updates", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onPlan = vi.fn();

    session.prompt("plan something", { onPlan });

    const planUpdate = {
      sessionUpdate: "plan" as const,
      entries: [
        { content: "Step 1", priority: "high" as const, status: "pending" as const },
      ],
    };
    session.handleUpdate(planUpdate);

    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(onPlan).toHaveBeenCalledWith(planUpdate);
  });

  it("onComplete callback fires and clears prompt callbacks", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onComplete = vi.fn();
    const onMessage = vi.fn();

    session.prompt("finish", { onMessage, onComplete });

    session.handleUpdate({
      sessionUpdate: "completed",
      stopReason: "end_turn",
    });

    expect(onComplete).toHaveBeenCalledWith({ stopReason: "end_turn" });

    // After completion, prompt callbacks should be cleared
    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "after complete" },
    });
    // onMessage should NOT be called again (callbacks cleared after completed)
    expect(onMessage).toHaveBeenCalledTimes(0);
  });

  it("subscribeToUpdates receives all update types alongside prompt callbacks", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());

    const persistentOnMessage = vi.fn();
    const promptOnMessage = vi.fn();

    session.subscribeToUpdates({ onMessage: persistentOnMessage });
    session.prompt("test", { onMessage: promptOnMessage });

    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "dual delivery" },
    });

    // Both should receive the message
    expect(persistentOnMessage).toHaveBeenCalledTimes(1);
    expect(promptOnMessage).toHaveBeenCalledTimes(1);
  });

  it("approveToolCall sends permission_response with selected outcome", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());

    session.approveToolCall("tc_42", "allow-always");

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0]).toEqual({
      type: "session:permission_response",
      sessionId: "sess_1",
      toolCallId: "tc_42",
      outcome: { outcome: "selected", optionId: "allow-always" },
    });
  });

  it("rejectToolCall sends permission_response with reject outcome", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());

    session.rejectToolCall("tc_42");

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0]).toEqual({
      type: "session:permission_response",
      sessionId: "sess_1",
      toolCallId: "tc_42",
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  });

  it("promptWithContent sends multi-content prompts", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());

    session.promptWithContent(
      [
        { type: "text", text: "look at this" },
        { type: "resource", resource: { uri: "file:///tmp/test.ts", mimeType: "text/typescript", text: "const x = 1;" } },
      ],
      { onMessage: vi.fn() },
    );

    expect(transport.sentMessages).toHaveLength(2); // subscribe + prompt
    const promptMsg = transport.sentMessages[1] as any;
    expect(promptMsg.type).toBe("session:prompt");
    expect(promptMsg.prompt).toHaveLength(2);
  });

  it("handleSnapshot dispatches to onHistorySync", () => {
    const transport = createMockTransport();
    const session = new MatrixSession("sess_1", transport, vi.fn());
    const onHistorySync = vi.fn();

    session.prompt("test", { onHistorySync });
    session.handleSnapshot([
      { id: "h1", sessionId: "sess_1", role: "user", content: "hi", timestamp: "2026-01-01", type: "text" },
      { id: "h2", sessionId: "sess_1", role: "agent", content: "hello", timestamp: "2026-01-01", type: "text" },
    ]);

    expect(onHistorySync).toHaveBeenCalledTimes(1);
    expect(onHistorySync).toHaveBeenCalledWith([
      expect.objectContaining({ role: "user", content: "hi" }),
      expect.objectContaining({ role: "agent", content: "hello" }),
    ]);
  });
});
