import type { BridgeClient } from "../bridge-client";
import { waitFor } from "../ui";

/** Verify the app is connected and the sidecar is running. */
export async function verifyConnected(bridge: BridgeClient): Promise<void> {
  const health = await bridge.health();
  if (!health.ok) {
    throw new Error("App health check failed");
  }
  if (!health.sidecarReady) {
    throw new Error("Sidecar is not ready");
  }

  // Wait for connected status indicator in the UI
  await waitFor('[data-testid="connection-status-connected"]', { timeout: 15_000 });
}

/** Get the current connection state from the bridge. */
export async function getConnectionState(bridge: BridgeClient) {
  return bridge.state();
}
