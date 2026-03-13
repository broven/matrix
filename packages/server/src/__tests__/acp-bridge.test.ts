import { describe, it, expect } from "vitest";
import { encodeJsonRpc, parseJsonRpcMessages } from "../acp-bridge/jsonrpc.js";

describe("jsonrpc", () => {
  it("encodes a JSON-RPC request", () => {
    const encoded = encodeJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(encoded).toContain("Content-Length:");
    expect(encoded).toContain('"jsonrpc":"2.0"');
  });

  it("parses a single JSON-RPC message from buffer", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const raw = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].result).toEqual({ ok: true });
    expect(remainder).toBe("");
  });

  it("handles partial messages", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg.slice(0, 5)}`;
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(0);
    expect(remainder.length).toBeGreaterThan(0);
  });

  it("parses multiple messages from buffer", () => {
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { a: 1 } });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { b: 2 } });
    const raw = `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(2);
    expect(remainder).toBe("");
  });
});
