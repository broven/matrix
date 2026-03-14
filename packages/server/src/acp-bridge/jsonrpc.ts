export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Encode a JSON-RPC message for ACP stdio transport.
 * ACP spec: messages are newline-delimited JSON, MUST NOT contain embedded newlines.
 */
export function encodeJsonRpc(message: JsonRpcMessage): string {
  return JSON.stringify(message) + "\n";
}

/**
 * Parse newline-delimited JSON-RPC messages from a buffer.
 * Returns parsed messages and any remaining incomplete data.
 */
export function parseJsonRpcMessages(buffer: string): {
  messages: JsonRpcMessage[];
  remainder: string;
} {
  const messages: JsonRpcMessage[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const newlineIndex = buffer.indexOf("\n", pos);
    if (newlineIndex === -1) break;

    const line = buffer.slice(pos, newlineIndex).trim();
    pos = newlineIndex + 1;

    if (line.length === 0) continue;

    try {
      messages.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return { messages, remainder: buffer.slice(pos) };
}
