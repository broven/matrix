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

function readJsonRpcFromStdin(process: MockChildProcess): any {
  const raw = process.stdin.read()?.toString();
  expect(raw).toBeTruthy();
  return JSON.parse(String(raw).trim());
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

  it("synthesizes a completed update when session/prompt resolves without one", async () => {
    const { process, bridge, handlers } = createBridge();

    const promptPromise = bridge.sendPrompt("sess_1", [{ type: "text", text: "hello" }]);

    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`,
    );

    await expect(promptPromise).resolves.toEqual({ ok: true });
    expect(handlers.onSessionUpdate).toHaveBeenCalledWith(
      "sess_1",
      expect.objectContaining({
        sessionUpdate: "completed",
        stopReason: "end_turn",
      }),
    );
  });

  it("stores initialize capabilities for later use", async () => {
    const { process, bridge } = createBridge();

    const promise = bridge.initialize({ name: "matrix-test", version: "0.1.0" });
    const request = readJsonRpcFromStdin(process);

    expect(request.method).toBe("initialize");

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          capabilities: {
            loadSession: true,
          },
        },
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      capabilities: {
        loadSession: true,
      },
    });
    expect((bridge as any).capabilities).toEqual({
      loadSession: true,
    });
  });

  it("stores initialize serverCapabilities for later use", async () => {
    const { process, bridge } = createBridge();

    const promise = bridge.initialize({ name: "matrix-test", version: "0.1.0" });
    const request = readJsonRpcFromStdin(process);

    expect(request.method).toBe("initialize");

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          serverCapabilities: {
            loadSession: true,
          },
        },
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      serverCapabilities: {
        loadSession: true,
      },
    });
    expect((bridge as any).capabilities).toEqual({
      loadSession: true,
    });
  });

  it("loads an existing session and updates the agent session id", async () => {
    const { process, bridge } = createBridge();

    const promise = (bridge as any).loadSession("agent_existing", "/tmp/project");
    const request = readJsonRpcFromStdin(process);

    expect(request.method).toBe("session/load");
    expect(request.params).toEqual({
      sessionId: "agent_existing",
      cwd: "/tmp/project",
      mcpServers: [],
    });

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          sessionId: "agent_existing",
        },
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      sessionId: "agent_existing",
    });
    expect(bridge.agentSessionId).toBe("agent_existing");
  });

  it("does not synthesize a duplicate completed update after loading an existing agent session", async () => {
    const { process, bridge, handlers } = createBridge();

    const loadPromise = bridge.loadSession("agent_existing", "/tmp/project");
    const loadRequest = readJsonRpcFromStdin(process);
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: loadRequest.id,
        result: {
          sessionId: "agent_existing",
        },
      })}\n`,
    );
    await expect(loadPromise).resolves.toEqual({ sessionId: "agent_existing" });

    const promptPromise = bridge.sendPrompt("sess_matrix", [{ type: "text", text: "hello" }]);
    const promptRequest = readJsonRpcFromStdin(process);
    expect(promptRequest.params.sessionId).toBe("agent_existing");

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "agent_existing",
          update: {
            sessionUpdate: "completed",
            stopReason: "end_turn",
          },
        },
      })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: promptRequest.id, result: { ok: true } })}\n`,
    );

    await expect(promptPromise).resolves.toEqual({ ok: true });
    expect(
      handlers.onSessionUpdate.mock.calls.filter(
        ([, update]) => update.sessionUpdate === "completed",
      ),
    ).toHaveLength(1);
  });
});
