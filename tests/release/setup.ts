import { afterEach, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "./lib/bridge-client";
import { diagnose, setBridge } from "./lib/ui";

let bridge: BridgeClient;

beforeAll(async () => {
  bridge = await createBridgeClient();
  setBridge(bridge);

  // Health check with retries (bridge may be recovering from a previous test's reload)
  for (let i = 0; i < 10; i++) {
    try {
      const health = await bridge.health();
      if (health.ok && health.webviewReady && health.sidecarReady) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Automation bridge health check failed after retries — is the app running?");
});

afterEach(async (context) => {
  if (context.task.result?.state === "fail") {
    const snapshot = await diagnose().catch((err) => `diagnose() failed: ${err}`);
    console.error(`\n[DOM Snapshot] Test "${context.task.name}" failed.\n${snapshot}\n`);
  }
});

export { bridge };
