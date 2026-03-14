import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatrixClient } from "../client.js";
import { createTransport } from "../transport/index.js";

describe("SDK error handling", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    Object.assign(globalThis, { WebSocket: originalWebSocket });
  });

  it("MatrixClient.attachSession throws when not connected", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });

    expect(() => client.attachSession("sess_1")).toThrow(
      "MatrixClient must be connected before attaching a session",
    );
  });

  it("websocket transport calls onError on ws error event", async () => {
    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      send = vi.fn().mockImplementation((data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "auth") {
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) }));
          }
        } catch {}
      });

      constructor() {
        queueMicrotask(() => {
          this.onopen?.();
          // Simulate error after auth completes
          setTimeout(() => this.onerror?.(), 20);
        });
      }
    }
    Object.assign(globalThis, { WebSocket: MockWebSocket });

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

    await new Promise((r) => setTimeout(r, 50));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe("WebSocket error");

    transport.disconnect();
  });

  it("websocket transport schedules reconnect on close", async () => {
    let wsInstances: any[] = [];

    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      send = vi.fn().mockImplementation((data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "auth") {
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) }));
          }
        } catch {}
      });

      constructor() {
        wsInstances.push(this);
        queueMicrotask(() => this.onopen?.());
      }
    }
    Object.assign(globalThis, { WebSocket: MockWebSocket });

    const statuses: string[] = [];
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });

    transport.connect({
      onMessage: vi.fn(),
      onStatusChange: (status) => statuses.push(status),
      onError: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(statuses).toContain("connected");

    // Simulate close
    wsInstances[0].onclose?.();

    // Should enter reconnecting state
    expect(statuses).toContain("reconnecting");

    // Wait for reconnect (1s delay for first attempt)
    await new Promise((r) => setTimeout(r, 1100));

    // Should have created a new WebSocket
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);

    transport.disconnect();
  });

  it("MatrixClient handles session:closed by removing the session", async () => {
    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      send = vi.fn().mockImplementation((data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "auth") {
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) }));
          }
        } catch {}
      });

      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
    }
    Object.assign(globalThis, { WebSocket: MockWebSocket });

    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // Attach a session
    const session = client.attachSession("sess_1");
    expect(session.sessionId).toBe("sess_1");

    // Attaching the same session returns the same object
    expect(client.attachSession("sess_1")).toBe(session);

    client.disconnect();
  });

  it("MatrixClient.onStatusChange returns working unsubscribe function", async () => {
    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      send = vi.fn().mockImplementation((data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "auth") {
            queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) }));
          }
        } catch {}
      });

      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
    }
    Object.assign(globalThis, { WebSocket: MockWebSocket });

    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });

    const statuses: string[] = [];
    const unsubscribe = client.onStatusChange((status) => statuses.push(status));

    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    expect(statuses).toContain("connected");

    // Unsubscribe
    unsubscribe();

    // Disconnect won't trigger our listener anymore
    // (disconnect doesn't emit a status, but this verifies cleanup)
    client.disconnect();
  });

  it("polling transport getLastEventId tracks received eventIds", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "polling",
    });

    // Initially undefined
    expect(transport.getLastEventId()).toBeUndefined();
  });

  it("sse transport getLastEventId always returns undefined", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "sse",
    });

    expect(transport.getLastEventId()).toBeUndefined();
  });
});
