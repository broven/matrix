import { describe, it, expect } from "vitest";
import { createBridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { verifyConnected } from "../lib/flows/connect";
import { expectVisible } from "../lib/assertions";

describe("连接 Sidecar 服务", () => {
  it("Automation Bridge 健康检查通过", async () => {
    const bridge = createBridgeClient();
    setBridge(bridge);

    const health = await bridge.health();
    expect(health.ok).toBe(true);
    expect(health.clientCount).toBeGreaterThan(0);
  });

  it("Bridge client 已连接", async () => {
    const bridge = createBridgeClient();
    const health = await bridge.health();
    expect(health.clients.length).toBeGreaterThan(0);
    expect(health.clients[0].platform).toBeTruthy();
  });

  it("UI 显示已连接状态", async () => {
    const bridge = createBridgeClient();
    setBridge(bridge);

    await verifyConnected(bridge);
    await expectVisible('[data-testid="connection-status-connected"]');
  });
});
