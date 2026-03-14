import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AcpBridge, TimeoutError, REQUEST_TIMEOUT_MS } from "../acp-bridge/index.js";

class MockChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill = vi.fn();
}

function createBridge() {
  const process = new MockChildProcess();
  const handlers = {
    onSessionUpdate: vi.fn(),
    onPermissionRequest: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
  const bridge = new AcpBridge(process as never, handlers);
  return { process, handlers, bridge };
}

describe("AcpBridge request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects pending request after timeout", async () => {
    const { bridge } = createBridge();

    const promise = bridge.request("test/method", { foo: 1 });

    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);

    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("resolves normally if response arrives before timeout", async () => {
    const { process, bridge } = createBridge();

    const promise = bridge.request("test/method", {});

    // Simulate a response arriving
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`,
    );

    await expect(promise).resolves.toEqual({ ok: true });

    // Advancing past timeout should not cause issues
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + 1000);
  });

  it("rejects all pending requests when agent process closes", async () => {
    const { process, bridge } = createBridge();

    const p1 = bridge.request("method1", {});
    const p2 = bridge.request("method2", {});

    process.emit("close");

    await expect(p1).rejects.toThrow("Agent process closed");
    await expect(p2).rejects.toThrow("Agent process closed");
  });

  it("rejects all pending requests when bridge is destroyed", async () => {
    const { bridge } = createBridge();

    const p1 = bridge.request("method1", {});
    const p2 = bridge.request("method2", {});

    bridge.destroy();

    await expect(p1).rejects.toThrow("Bridge destroyed");
    await expect(p2).rejects.toThrow("Bridge destroyed");
  });

  it("does not reject already-resolved requests on close", async () => {
    const { process, bridge } = createBridge();

    const promise = bridge.request("test/method", {});

    // Respond first
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { done: true } })}\n`,
    );

    await expect(promise).resolves.toEqual({ done: true });

    // Close should not cause errors
    process.emit("close");
  });
});
