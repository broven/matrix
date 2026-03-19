#!/usr/bin/env node

/**
 * Minimal ACP-compatible mock agent for release tests.
 *
 * Accepts JSON-RPC 2.0 over stdio:
 * - initialize → returns capabilities
 * - session/create → returns a session ID
 * - session/load → returns success
 * - prompt/send → returns a fixed response
 * - permission/respond → no-op
 *
 * Usage: node tests/release/fixtures/mock-agent/index.mjs
 */

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(response) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "0.1.0",
          capabilities: {
            tools: true,
            permissions: true,
          },
          serverInfo: {
            name: "mock-agent",
            version: "0.0.1",
          },
        },
      });

    case "session/create":
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          sessionId: `mock-session-${Date.now()}`,
        },
      });

    case "session/load":
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          sessionId: params?.agentSessionId ?? `mock-session-${Date.now()}`,
        },
      });

    case "prompt/send": {
      // Send a fixed assistant response
      const sessionId = params?.sessionId;

      // First send message chunks as notifications
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Hello from mock agent! This is a test response.",
          },
        },
      });

      // Then send completion
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          sessionUpdate: "completed",
        },
      });

      // Respond to the request
      return send({
        jsonrpc: "2.0",
        id,
        result: { ok: true },
      });
    }

    case "permission/respond":
      return send({
        jsonrpc: "2.0",
        id,
        result: { ok: true },
      });

    default:
      return send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
  }
}

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    // Ignore notifications (no id)
    if (msg.id !== undefined) {
      handleRequest(msg);
    }
  } catch {
    // Ignore malformed input
  }
});

// Keep the process alive
process.stdin.resume();
