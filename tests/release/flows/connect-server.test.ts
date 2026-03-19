import { describe, it, expect } from "vitest";
import { createBridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { verifyConnected } from "../lib/flows/connect";
import { expectVisible } from "../lib/assertions";

describe("连接 Sidecar 服务", () => {
  it("Automation Bridge 健康检查通过", async () => {
    const bridge = await createBridgeClient();
    setBridge(bridge);

    const health = await bridge.health();
    expect(health.ok).toBe(true);
    expect(health.appReady).toBe(true);
    expect(health.webviewReady).toBe(true);
  });

  it("Sidecar 正在运行", async () => {
    const bridge = await createBridgeClient();
    const health = await bridge.health();
    expect(health.sidecarReady).toBe(true);
  });

  it("UI 显示已连接状态", async () => {
    const bridge = await createBridgeClient();
    setBridge(bridge);

    await verifyConnected(bridge);
    await expectVisible('[data-testid="connection-status-connected"]');
  });
});
