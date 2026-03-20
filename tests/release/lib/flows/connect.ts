import type { BridgeClient } from "../bridge-client";
import { waitFor } from "../ui";

/** Verify the app is connected and a bridge client is available. */
export async function verifyConnected(bridge: BridgeClient): Promise<void> {
  const health = await bridge.health();
  if (!health.ok) {
    throw new Error("App health check failed");
  }
  if (health.clientCount === 0) {
    throw new Error("No bridge clients connected");
  }

  await waitFor('[data-testid="connection-status-connected"]', { timeout: 15_000 });
}
