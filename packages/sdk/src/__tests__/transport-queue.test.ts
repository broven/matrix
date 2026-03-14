import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTransport, MAX_QUEUED_MESSAGES } from "../transport/index.js";
import type { TransportEventHandler } from "../transport/index.js";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Simulate the connection opening and authentication
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateAuthenticated() {
    this.onmessage?.({ data: JSON.stringify({ type: "authenticated" }) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Store instances so tests can control them
let wsInstances: MockWebSocket[] = [];

beforeEach(() => {
  wsInstances = [];
  // @ts-expect-error - mocking global WebSocket
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(_url: string) {
      super();
      wsInstances.push(this);
    }
  };
  // Also set the static properties on the constructor
  // @ts-expect-error - mocking
  globalThis.WebSocket.OPEN = MockWebSocket.OPEN;
  // @ts-expect-error - mocking
  globalThis.WebSocket.CONNECTING = MockWebSocket.CONNECTING;
  // @ts-expect-error - mocking
  globalThis.WebSocket.CLOSING = MockWebSocket.CLOSING;
  // @ts-expect-error - mocking
  globalThis.WebSocket.CLOSED = MockWebSocket.CLOSED;
});

afterEach(() => {
  // @ts-expect-error - cleanup
  delete globalThis.WebSocket;
});

function createHandlers(): TransportEventHandler {
  return {
    onMessage: vi.fn(),
    onStatusChange: vi.fn(),
    onError: vi.fn(),
  };
}

describe("WebSocketTransport message queue", () => {
  it("queues messages when socket is not open", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });
    const handlers = createHandlers();
    transport.connect(handlers);

    const ws = wsInstances[0];
    // Socket is still CONNECTING, not OPEN
    transport.send({ type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: "hello" }] } as never);

    // Message should not have been sent on the wire
    expect(ws.sent).toHaveLength(0);
  });

  it("flushes queued messages after authentication", () => {
    vi.useFakeTimers();
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });
    const handlers = createHandlers();
    transport.connect(handlers);

    const ws = wsInstances[0];

    // Send while still connecting
    const msg1 = { type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: "hello" }] } as never;
    const msg2 = { type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: "world" }] } as never;
    transport.send(msg1);
    transport.send(msg2);

    expect(ws.sent).toHaveLength(0);

    // Simulate open + auth
    ws.simulateOpen();
    ws.simulateAuthenticated();

    // Auth message + 2 queued messages
    // First sent is the auth message from onopen
    expect(ws.sent).toHaveLength(3);
    expect(ws.sent[0]).toContain('"type":"auth"');
    expect(ws.sent[1]).toContain("hello");
    expect(ws.sent[2]).toContain("world");

    vi.useRealTimers();
  });

  it("drops oldest messages when queue exceeds max size", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });
    const handlers = createHandlers();
    transport.connect(handlers);

    // Send MAX_QUEUED_MESSAGES + 5 messages while disconnected
    for (let i = 0; i < MAX_QUEUED_MESSAGES + 5; i++) {
      transport.send({ type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: `msg-${i}` }] } as never);
    }

    const ws = wsInstances[0];
    ws.simulateOpen();
    ws.simulateAuthenticated();

    // auth message + MAX_QUEUED_MESSAGES flushed
    expect(ws.sent).toHaveLength(1 + MAX_QUEUED_MESSAGES);
    // First queued message should be msg-5 (oldest 5 were dropped)
    expect(ws.sent[1]).toContain("msg-5");
    // Last queued message should be the last one sent
    expect(ws.sent[ws.sent.length - 1]).toContain(`msg-${MAX_QUEUED_MESSAGES + 4}`);
  });

  it("clears queue on disconnect", () => {
    vi.useFakeTimers();
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });
    const handlers = createHandlers();
    transport.connect(handlers);

    transport.send({ type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: "queued" }] } as never);

    transport.disconnect();

    // Reconnect - create a new transport to verify queue was cleared
    // (disconnect clears the queue)
    transport.connect(handlers);
    const ws2 = wsInstances[1];
    ws2.simulateOpen();
    ws2.simulateAuthenticated();

    // Only auth message, no flushed queued messages
    expect(ws2.sent).toHaveLength(1);
    expect(ws2.sent[0]).toContain('"type":"auth"');

    vi.useRealTimers();
  });

  it("sends directly when socket is open", () => {
    vi.useFakeTimers();
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "websocket",
    });
    const handlers = createHandlers();
    transport.connect(handlers);

    const ws = wsInstances[0];
    ws.simulateOpen();
    ws.simulateAuthenticated();

    const sentBefore = ws.sent.length;
    transport.send({ type: "prompt", sessionId: "s1", prompt: [{ type: "text", text: "direct" }] } as never);

    expect(ws.sent).toHaveLength(sentBefore + 1);
    expect(ws.sent[ws.sent.length - 1]).toContain("direct");

    vi.useRealTimers();
  });
});
