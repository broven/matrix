import { describe, expect, it, vi } from "vitest";
import { MatrixSession } from "../session.js";

describe("MatrixSession", () => {
  it("notifies persistent listeners for updates and snapshots", () => {
    const sent: unknown[] = [];
    const session = new MatrixSession(
      "sess_1",
      {
        type: "websocket",
        connect: vi.fn(),
        disconnect: vi.fn(),
        getLastEventId() {
          return undefined;
        },
        send(message) {
          sent.push(message);
        },
      },
      vi.fn(),
    );

    const onMessage = vi.fn();
    const onHistorySync = vi.fn();
    const dispose = session.subscribeToUpdates({ onMessage, onHistorySync });

    session.subscribe("42");
    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    session.handleSnapshot([
      {
        id: "h1",
        sessionId: "sess_1",
        role: "agent",
        content: "snapshot",
        timestamp: new Date().toISOString(),
      },
    ]);

    dispose();
    session.handleUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "ignored" },
    });

    expect(sent).toContainEqual({
      type: "session:subscribe",
      sessionId: "sess_1",
      lastEventId: "42",
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onHistorySync).toHaveBeenCalledTimes(1);
  });
});
