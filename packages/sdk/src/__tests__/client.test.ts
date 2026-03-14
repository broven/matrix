import { describe, it, expect, vi } from "vitest";
import type { ServerMessage } from "@matrix/protocol";
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

  it("accepts lifecycle transport events without removing an attached session", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
      transport: "polling",
    });

    (client as any).transport = {
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getLastEventId: vi.fn(),
      type: "polling",
    };

    const session = client.attachSession("sess_existing");

    const suspendedMessage: ServerMessage = {
      type: "session:suspended",
      sessionId: "sess_existing",
      eventId: "1",
    };
    const restoringMessage: ServerMessage = {
      type: "session:restoring",
      sessionId: "sess_existing",
      eventId: "2",
    };

    expect(() => {
      (client as any).handleServerMessage(suspendedMessage);
      (client as any).handleServerMessage(restoringMessage);
    }).not.toThrow();

    expect(client.attachSession("sess_existing")).toBe(session);
  });

  it("accepts a close reason on session:closed messages", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
      transport: "polling",
    });

    (client as any).transport = {
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getLastEventId: vi.fn(),
      type: "polling",
    };

    const session = client.attachSession("sess_existing");
    expect(session.sessionId).toBe("sess_existing");

    const closedMessage: ServerMessage = {
      type: "session:closed",
      sessionId: "sess_existing",
      reason: "server_restart_unrecoverable",
    };

    expect(() => {
      (client as any).handleServerMessage(closedMessage);
    }).not.toThrow();

    expect(client.attachSession("sess_existing")).not.toBe(session);
  });
});
