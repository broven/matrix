import { beforeAll, afterAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "./lib/bridge-client";
import { setBridge } from "./lib/ui";

let bridge: BridgeClient;

beforeAll(async () => {
  bridge = await createBridgeClient();
  setBridge(bridge);

  // Verify the app is healthy
  const health = await bridge.health();
  if (!health.ok) {
    throw new Error("Automation bridge health check failed — is the app running?");
  }
  if (!health.webviewReady) {
    throw new Error("Webview is not ready");
  }

  // Reset test state before the suite
  await bridge.reset();
});

afterAll(async () => {
  // Reset test state after the suite
  if (bridge) {
    await bridge.reset();
  }
});

export { bridge };
