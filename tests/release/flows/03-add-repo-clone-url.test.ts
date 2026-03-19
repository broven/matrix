import { describe, it, beforeAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor } from "../lib/ui";
import { cloneFromUrl } from "../lib/flows/repository";

const TEST_REPO_URL = "https://github.com/broven/matrix-test-clone.git";
const REPO_NAME = "matrix-test-clone";
// Default clone target based on server config reposPath
const CLONE_TARGET = `/Users/metajs/Projects/repos/${REPO_NAME}`;

describe("03 — Add Repository (Clone from URL)", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Remove previously cloned directory to avoid git clone exit 128
    await rm(CLONE_TARGET, { recursive: true, force: true }).catch(() => {});
  });

  it("should open clone dialog and accept a URL", async () => {
    await cloneFromUrl(bridge, TEST_REPO_URL);

    // Wait for the repo to appear in sidebar (clone may take time)
    await waitFor(`[data-testid="repo-item-${REPO_NAME}"]`, { timeout: 30_000 });
  });
});
