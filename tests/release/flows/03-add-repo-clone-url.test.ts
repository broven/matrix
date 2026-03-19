import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor } from "../lib/ui";
import { cloneFromUrl } from "../lib/flows/repository";

describe("03 — Add Repository (Clone from URL)", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open clone dialog and accept a URL", async () => {
    // Use a small, fast-cloning repo
    const testUrl = "https://github.com/nicolo-ribaudo/tc39-proposal-first-last.git";

    await cloneFromUrl(bridge, testUrl);

    // Wait for the repo to appear (clone may take time)
    await waitFor('[data-testid^="repo-item-"]', { timeout: 30_000 });
  });
});
