import { describe, it, expect, vi } from "vitest";
import { MatrixClient } from "../client.js";

describe("MatrixClient", () => {
  it("constructs with config", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client).toBeDefined();
  });

  it("defaults transport to auto", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client.transportMode).toBe("auto");
  });

  it("stores serverUrl", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client.serverUrl).toBe("http://localhost:8080");
  });

  it("accepts custom transport mode", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
      transport: "sse",
    });
    expect(client.transportMode).toBe("sse");
  });

  it("attaches an existing session after connect", () => {
    const originalWebSocket = globalThis.WebSocket;
    class MockWebSocket {
      static OPEN = 1;
      readyState = MockWebSocket.OPEN;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send = vi.fn();
      close = vi.fn();
    }
    Object.assign(globalThis, { WebSocket: MockWebSocket });

    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });

    client.connect();
    const session = client.attachSession("sess_existing");

    expect(session.sessionId).toBe("sess_existing");
    expect(client.attachSession("sess_existing")).toBe(session);

    Object.assign(globalThis, { WebSocket: originalWebSocket });
  });
});
