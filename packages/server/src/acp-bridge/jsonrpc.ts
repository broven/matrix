export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function encodeJsonRpc(message: JsonRpcMessage): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

export function parseJsonRpcMessages(buffer: string): {
  messages: JsonRpcMessage[];
  remainder: string;
} {
  const messages: JsonRpcMessage[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", pos);
    if (headerEnd === -1) break;

    const header = buffer.slice(pos, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (bodyEnd > buffer.length) break;

    const body = buffer.slice(bodyStart, bodyEnd);
    messages.push(JSON.parse(body));
    pos = bodyEnd;
  }

  return { messages, remainder: buffer.slice(pos) };
}
