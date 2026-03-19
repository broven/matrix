#!/usr/bin/env node

/**
 * CI helper: poll until the Automation Bridge is ready.
 * Checks for the discovery file and then hits the /health endpoint.
 *
 * Usage: node tests/release/scripts/wait-for-bridge.mjs [--timeout 60]
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DISCOVERY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Matrix",
  "dev",
  "automation.json",
);

const args = process.argv.slice(2);
const timeoutIndex = args.indexOf("--timeout");
const timeoutSec = timeoutIndex !== -1 ? Number(args[timeoutIndex + 1]) : 60;
const deadline = Date.now() + timeoutSec * 1000;
const POLL_MS = 1000;

async function tryDiscovery() {
  try {
    const raw = await readFile(DISCOVERY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  console.log(`Waiting for Automation Bridge (timeout: ${timeoutSec}s)...`);

  while (Date.now() < deadline) {
    const discovery = await tryDiscovery();
    if (discovery?.enabled && discovery.baseUrl && discovery.token) {
      const health = await tryHealth(discovery.baseUrl, discovery.token);
      if (health?.ok && health?.webviewReady) {
        console.log(`Bridge ready at ${discovery.baseUrl}`);
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
