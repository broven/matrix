import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTransport } from "../transport/index.js";

describe("WebSocket reconnection with event replay", () => {
  const originalWebSocket = globalThis.WebSocket;
  let mockInstances: any[] = [];

  beforeEach(() => {
    mockInstances = [];

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      url: string;

      send = vi.fn().mockImplementation((data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "auth") {
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) }));
          }
        } catch {}
      });

      constructor(url: string) {
        this.url = url;
        mockInstances.push(this);
        queueMicrotask(() => this.onopen?.());
      }
    }

    Object.assign(globalThis, { WebSocket: MockWebSocket });
  });

  afterEach(() => {
    Object.assign(globalThis, { WebSocket: originalWebSocket });
  });

  it("tracks lastEventId from server messages", async () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    const onMessage = vi.fn();
    transport.connect({
      onMessage,
      onStatusChange: vi.fn(),
      onError: vi.fn(),
    });

    // Wait for onopen microtask
    await new Promise((r) => setTimeout(r, 10));

    const ws = mockInstances[0];
    // Simulate receiving messages with eventIds
    ws.onmessage?.({ data: JSON.stringify({ type: "session:update", eventId: "5", sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } }) });
    ws.onmessage?.({ data: JSON.stringify({ type: "session:update", eventId: "10", sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } } }) });

    expect(transport.getLastEventId()).toBe("10");
    expect(onMessage).toHaveBeenCalledTimes(2);

    transport.disconnect();
  });

  it("getLastEventId returns undefined when no messages received", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    expect(transport.getLastEventId()).toBeUndefined();
  });

  it("filters out pong messages", async () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    const onMessage = vi.fn();
    transport.connect({
      onMessage,
      onStatusChange: vi.fn(),
      onError: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 10));

    const ws = mockInstances[0];
    ws.onmessage?.({ data: JSON.stringify({ type: "pong" }) });

    expect(onMessage).not.toHaveBeenCalled();
    transport.disconnect();
  });

  it("reports connecting then connected status", async () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    const statuses: string[] = [];
    transport.connect({
      onMessage: vi.fn(),
      onStatusChange: (status) => statuses.push(status),
      onError: vi.fn(),
    });

    // "connecting" is emitted synchronously
    expect(statuses[0]).toBe("connecting");

    // Wait for onopen microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(statuses[1]).toBe("connected");

    transport.disconnect();
  });

  it("calls onError for unparseable messages", async () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    const onError = vi.fn();
    transport.connect({
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
      onError,
    });

    await new Promise((r) => setTimeout(r, 10));

    const ws = mockInstances[0];
    ws.onmessage?.({ data: "not json{{{" });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    transport.disconnect();
  });
});
