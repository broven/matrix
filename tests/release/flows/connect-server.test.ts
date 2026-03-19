import { describe, it, expect } from "vitest";
import { createBridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { verifyConnected } from "../lib/flows/connect";
import { expectVisible } from "../lib/assertions";

describe("Connect to Server", () => {
  it("should have a healthy automation bridge", async () => {
    const bridge = await createBridgeClient();
    setBridge(bridge);

    const health = await bridge.health();
    expect(health.ok).toBe(true);
    expect(health.appReady).toBe(true);
    expect(health.webviewReady).toBe(true);
  });

  it("should show the sidecar is running", async () => {
    const bridge = await createBridgeClient();
    const health = await bridge.health();
    expect(health.sidecarReady).toBe(true);
  });

  it("should show connected status in the UI", async () => {
    const bridge = await createBridgeClient();
    setBridge(bridge);

    await verifyConnected(bridge);
    await expectVisible('[data-testid="connection-status-connected"]');
  });
});
