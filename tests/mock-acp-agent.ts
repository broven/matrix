#!/usr/bin/env bun
/**
 * Mock ACP agent for e2e testing.
 * Implements the minimal ACP protocol over stdin/stdout (newline-delimited JSON-RPC).
 *
 * Supported methods:
 *   initialize   → returns agent info + capabilities (loadSession: true)
 *   session/new  → creates a session, returns sessionId
 *   session/load → loads an existing session (for cross-profile resume testing)
 *   session/prompt → returns fixed text response (or echoes input if prefixed with "echo:")
 *   session/cancel → no-op acknowledgment
 */

import { createInterface } from "node:readline";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string };
}

let sessionCounter = 0;
const sessions = new Map<string, { cwd: string }>();

function send(msg: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id: number | string, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendUpdate(sessionId: string, update: Record<string, unknown>): void {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

function handleMessage(msg: JsonRpcMessage): void {
  if (!msg.method || msg.id === undefined) return;

  switch (msg.method) {
    case "initialize": {
      sendResult(msg.id, {
        serverCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: false,
          },
        },
        agentInfo: {
          name: "mock-acp-agent",
          title: "Mock ACP Agent",
          version: "1.0.0",
        },
      });
      break;
    }

    case "session/new": {
      const sessionId = `mock_sess_${++sessionCounter}`;
      const cwd = msg.params?.cwd ?? "/tmp";
      sessions.set(sessionId, { cwd });
      sendResult(msg.id, {
        sessionId,
        modes: {
          currentModeId: "default",
          availableModes: [{ id: "default", name: "Default", description: "Default mode" }],
        },
      });
      break;
    }

    case "session/load": {
      const sessionId = msg.params?.sessionId;
      const cwd = msg.params?.cwd ?? "/tmp";
      if (sessionId) {
        sessions.set(sessionId, { cwd });
      }
      sendResult(msg.id, {
        sessionId: sessionId ?? `mock_sess_${++sessionCounter}`,
        modes: {
          currentModeId: "default",
          availableModes: [{ id: "default", name: "Default", description: "Default mode" }],
        },
      });
      break;
    }

    case "session/prompt": {
      const sessionId = msg.params?.sessionId;
      const prompt = msg.params?.prompt;
      const text = prompt?.[0]?.text ?? "";

      // Echo mode: if input starts with "echo:", echo it back
      let response: string;
      if (text.startsWith("echo:")) {
        response = text.slice(5).trim();
      } else {
        // Check for env var output request: "env:VAR_NAME"
        if (text.startsWith("env:")) {
          const varName = text.slice(4).trim();
          response = process.env[varName] ?? `<${varName} not set>`;
        } else {
          response = `Mock response to: ${text}`;
        }
      }

      // Send agent_message_chunk then completed
      sendUpdate(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: response },
      });
      sendUpdate(sessionId, {
        sessionUpdate: "completed",
        stopReason: "end_turn",
      });

      // Return prompt result
      sendResult(msg.id, { ok: true });
      break;
    }

    case "session/cancel": {
      // No-op, just acknowledge
      if (msg.id !== undefined) {
        sendResult(msg.id, { ok: true });
      }
      break;
    }

    default: {
      if (msg.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `Unknown method: ${msg.method}` },
        });
      }
    }
  }
}

// Read newline-delimited JSON-RPC from stdin
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg: JsonRpcMessage = JSON.parse(trimmed);
    handleMessage(msg);
  } catch {
    // Skip malformed input
  }
});

// Keep process alive
process.stdin.resume();
