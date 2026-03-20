#!/usr/bin/env node

/**
 * CI helper: poll until the Automation Bridge is ready.
 * Connects to the known port and hits the /health endpoint.
 *
 * Usage: node tests/release/scripts/wait-for-bridge.mjs [--timeout 60]
 */

import { createConnection } from "node:net";

const port = Number(process.env.MATRIX_AUTOMATION_PORT ?? "18765");
const token = process.env.MATRIX_AUTOMATION_TOKEN ?? "dev";

const args = process.argv.slice(2);
const timeoutIndex = args.indexOf("--timeout");
const timeoutSec = timeoutIndex !== -1 ? Number(args[timeoutIndex + 1]) : 60;
const deadline = Date.now() + timeoutSec * 1000;
const POLL_MS = 1000;

function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: 500 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function tryHealth(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Waiting for Automation Bridge on port ${port} (timeout: ${timeoutSec}s)...`);

  while (Date.now() < deadline) {
    const reachable = await tcpReachable("127.0.0.1", port);
    if (reachable) {
      const health = await tryHealth(baseUrl, token);
      if (health?.ok && health?.webviewReady) {
        console.log(`Bridge ready at ${baseUrl}`);
        process.exit(0);
      }
      if (health) {
        console.log(
          `Bridge responding but not fully ready (webviewReady=${health.webviewReady})`,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  console.error(`Timeout: bridge not ready after ${timeoutSec}s`);
  process.exit(1);
}

main();
