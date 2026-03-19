import { beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "./lib/bridge-client";
import { setBridge } from "./lib/ui";

let bridge: BridgeClient;

beforeAll(async () => {
  bridge = await createBridgeClient();
  setBridge(bridge);

  // Health check with retries (bridge may be recovering from a previous reload)
  for (let i = 0; i < 5; i++) {
    try {
      const health = await bridge.health();
      if (health.ok && health.webviewReady && health.sidecarReady) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Automation bridge health check failed after retries — is the app running?");
});

export { bridge };
