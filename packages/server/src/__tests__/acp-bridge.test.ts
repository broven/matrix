import { describe, it, expect } from "vitest";
import { encodeJsonRpc, parseJsonRpcMessages } from "../acp-bridge/jsonrpc.js";

describe("jsonrpc", () => {
  it("encodes a JSON-RPC message as newline-delimited JSON", () => {
    const encoded = encodeJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(encoded).toContain('"jsonrpc":"2.0"');
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded).not.toContain("Content-Length");
  });

  it("parses a single JSON-RPC message from buffer", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const raw = msg + "\n";
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].result).toEqual({ ok: true });
    expect(remainder).toBe("");
  });

  it("handles partial messages (no trailing newline)", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    // No newline = incomplete message
    const { messages, remainder } = parseJsonRpcMessages(msg);
    expect(messages).toHaveLength(0);
    expect(remainder).toBe(msg);
  });

  it("parses multiple messages from buffer", () => {
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { a: 1 } });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { b: 2 } });
    const raw = msg1 + "\n" + msg2 + "\n";
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(2);
    expect(remainder).toBe("");
  });

  it("skips empty lines", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = "\n\n" + msg + "\n\n";
    const { messages } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
  });
});
