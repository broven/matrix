#!/usr/bin/env node

/**
 * Mock ACP agent for release tests.
 *
 * Implements the ACP protocol over JSON-RPC 2.0 on stdio:
 * - initialize → capabilities + agent info
 * - session/new → session ID + modes, then available_commands_update notification
 * - session/load → session ID + modes
 * - session/prompt → message chunks + completed notification, then result
 * - session/cancel → ok
 *
 * Prompt modes:
 * - "echo:<text>" → echoes back <text>
 * - "env:<VAR>" → returns process.env[VAR]
 * - default → "Mock response to: <input>"
 *
 * Usage: node tests/release/fixtures/mock-agent/index.mjs
 */

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

let sessionCounter = 0;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendNotification(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const DEFAULT_MODES = {
  currentModeId: "default",
  availableModes: [{ id: "default", name: "Default" }],
};

const SLASH_COMMANDS = [
  { name: "compact", description: "Compact conversation history" },
  { name: "review", description: "Review current changes" },
  { name: "plan", description: "Create an implementation plan" },
];

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return sendResult(id, {
        protocolVersion: 1,
        serverCapabilities: {
          loadSession: true,
          promptCapabilities: {
            supportedModes: ["default"],
          },
        },
        agentInfo: {
          name: "mock-acp-agent",
          title: "Mock ACP Agent",
          version: "1.0.0",
        },
      });

    case "session/new": {
      sessionCounter++;
      const sessionId = `mock_sess_${sessionCounter}`;
      sendResult(id, { sessionId, modes: DEFAULT_MODES });
      // Send available_commands_update notification after session creation
      sendNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: SLASH_COMMANDS,
        },
      });
      return;
    }

    case "session/load": {
      const sessionId = params?.sessionId ?? `mock_sess_${++sessionCounter}`;
      return sendResult(id, { sessionId, modes: DEFAULT_MODES });
    }

    case "session/prompt": {
      const sessionId = params?.sessionId;
      const inputText = params?.prompt?.[0]?.text ?? "";

      let response;
      if (inputText.startsWith("echo:")) {
        response = inputText.slice(5);
      } else if (inputText.startsWith("env:")) {
        response = process.env[inputText.slice(4)] ?? "";
      } else {
        response = `Mock response to: ${inputText}`;
      }

      // Send agent_message_chunk notification
      sendNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: response },
        },
      });

      // Send completed notification
      sendNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "completed",
          stopReason: "end_turn",
        },
      });

      // Return result
      return sendResult(id, { stopReason: "end_turn" });
    }

    case "session/cancel":
      return sendResult(id, { ok: true });

    default:
      return sendError(id, -32601, `Method not found: ${method}`);
  }
}

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    // Only handle requests (messages with an id)
    if (msg.id !== undefined) {
      handleRequest(msg);
    }
  } catch {
    // Ignore malformed input
  }
});

// Keep the process alive
process.stdin.resume();
