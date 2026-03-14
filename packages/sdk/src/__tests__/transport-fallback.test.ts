import { describe, it, expect, vi } from "vitest";
import { createTransport } from "../transport/index.js";

describe("Transport fallback behavior", () => {
  it("auto mode creates a websocket transport", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test",
      mode: "auto",
    });
    expect(transport.type).toBe("websocket");
  });

  it("websocket transport sends messages only when readyState is OPEN", () => {
    const originalWebSocket = globalThis.WebSocket;
    let capturedInstance: any = null;

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.CLOSED;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(_url: string) {
        capturedInstance = this;
      }
    }

    Object.assign(globalThis, { WebSocket: MockWebSocket });

    try {
      const transport = createTransport({
        serverUrl: "http://localhost:8080",
        token: "test",
        mode: "websocket",
      });

      transport.connect({
        onMessage: vi.fn(),
        onStatusChange: vi.fn(),
        onError: vi.fn(),
      });

      // Before open - send should be a no-op (readyState is CLOSED)
      transport.send({ type: "ping" });
      expect(capturedInstance.send).not.toHaveBeenCalled();

      // After open
      capturedInstance.readyState = MockWebSocket.OPEN;
      transport.send({ type: "ping" });
      expect(capturedInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));

      transport.disconnect();
    } finally {
      Object.assign(globalThis, { WebSocket: originalWebSocket });
    }
  });

  it("each transport mode can be instantiated independently", () => {
    const modes = ["websocket", "sse", "polling"] as const;
    for (const mode of modes) {
      const transport = createTransport({
        serverUrl: "http://localhost:8080",
        token: "test",
        mode,
      });
      expect(transport.type).toBe(mode);
      expect(typeof transport.connect).toBe("function");
      expect(typeof transport.send).toBe("function");
      expect(typeof transport.disconnect).toBe("function");
      expect(typeof transport.getLastEventId).toBe("function");
    }
  });
});
