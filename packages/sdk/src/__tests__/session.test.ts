import type { SessionUpdate } from "@matrix/protocol";
import { describe, expect, it, vi } from "vitest";
import { MatrixSession } from "../session.js";

function createSession(): MatrixSession {
  return new MatrixSession(
    "sess_1",
    {
      type: "websocket",
      connect: vi.fn(),
      disconnect: vi.fn(),
      getLastEventId() {
        return undefined;
      },
      send: vi.fn(),
    },
    vi.fn(),
  );
}

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
        type: "text",
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

  describe("async iterator", () => {
    it("yields buffered updates that arrived before iteration", async () => {
      const session = createSession();

      session.handleUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      });
      session.handleUpdate({
        sessionUpdate: "completed",
        stopReason: "end_turn",
      });

      const updates: SessionUpdate[] = [];
      for await (const update of session) {
        updates.push(update);
        if (update.sessionUpdate === "completed") break;
      }

      expect(updates).toHaveLength(2);
      expect(updates[0].sessionUpdate).toBe("agent_message_chunk");
      expect(updates[1].sessionUpdate).toBe("completed");
    });

    it("waits for updates when buffer is empty", async () => {
      const session = createSession();

      const updates: SessionUpdate[] = [];
      const iterationDone = (async () => {
        for await (const update of session) {
          updates.push(update);
          if (update.sessionUpdate === "completed") break;
        }
      })();

      // Updates arrive after iteration has started
      await Promise.resolve(); // Let the iterator start waiting
      session.handleUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "delayed" },
      });
      session.handleUpdate({
        sessionUpdate: "completed",
        stopReason: "end_turn",
      });

      await iterationDone;

      expect(updates).toHaveLength(2);
      expect(updates[0].sessionUpdate).toBe("agent_message_chunk");
      expect(updates[1].sessionUpdate).toBe("completed");
    });

    it("returns done after completed update is consumed", async () => {
      const session = createSession();
      const iter = session[Symbol.asyncIterator]();

      session.handleUpdate({
        sessionUpdate: "completed",
        stopReason: "end_turn",
      });

      const first = await iter.next();
      expect(first.done).toBe(false);
      expect(first.value.sessionUpdate).toBe("completed");

      const second = await iter.next();
      expect(second.done).toBe(true);
    });

    it("supports early termination via return()", async () => {
      const session = createSession();
      const iter = session[Symbol.asyncIterator]();

      session.handleUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial" },
      });

      const first = await iter.next();
      expect(first.value.sessionUpdate).toBe("agent_message_chunk");

      const result = await iter.return!();
      expect(result.done).toBe(true);

      // Subsequent calls should also be done
      const after = await iter.next();
      expect(after.done).toBe(true);
    });

    it("resolves pending waiters on return()", async () => {
      const session = createSession();
      const iter = session[Symbol.asyncIterator]();

      // Start waiting (no updates yet)
      const pendingNext = iter.next();

      // Cancel the iterator
      await iter.return!();

      const result = await pendingNext;
      expect(result.done).toBe(true);
    });

    it("works alongside callback-based subscriptions", async () => {
      const session = createSession();
      const onMessage = vi.fn();
      session.subscribeToUpdates({ onMessage });

      const updates: SessionUpdate[] = [];
      const iterationDone = (async () => {
        for await (const update of session) {
          updates.push(update);
          if (update.sessionUpdate === "completed") break;
        }
      })();

      await Promise.resolve();
      session.handleUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "both" },
      });
      session.handleUpdate({
        sessionUpdate: "completed",
        stopReason: "end_turn",
      });

      await iterationDone;

      // Both callback and iterator should receive updates
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(updates).toHaveLength(2);
    });
  });
});
