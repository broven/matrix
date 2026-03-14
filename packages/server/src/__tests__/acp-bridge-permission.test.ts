import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AcpBridge } from "../acp-bridge/index.js";

class MockChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill = vi.fn();
}

describe("AcpBridge permission flow", () => {
  it("responds to permission requests by toolCallId", async () => {
    const process = new MockChildProcess();
    const bridge = new AcpBridge(process as never, {
      onSessionUpdate: vi.fn(),
      onPermissionRequest: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    });

    const writes: string[] = [];
    process.stdin.on("data", (chunk: Buffer) => {
      writes.push(chunk.toString("utf8"));
    });

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 77,
        method: "session/request_permission",
        params: {
          sessionId: "sess_1",
          toolCall: {
            toolCallId: "tool_1",
            title: "Write file",
            kind: "edit",
            status: "pending",
          },
          options: [],
        },
      })}\n`,
    );

    bridge.respondPermission("tool_1", { outcome: "selected", optionId: "allow_once" });

    expect(writes.at(-1)).toContain('"id":77');
    expect(writes.at(-1)).toContain('"optionId":"allow_once"');
    expect(JSON.parse(String(writes.at(-1)).trim())).toMatchObject({
      jsonrpc: "2.0",
      id: 77,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "allow_once",
        },
      },
    });
  });
});
