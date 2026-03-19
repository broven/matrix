import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor } from "../lib/ui";
import { cloneFromUrl } from "../lib/flows/repository";
import { resetUI, removeAllRepos } from "../lib/flows/setup";

const TEST_REPO_URL = "https://github.com/broven/matrix-test-clone.git";
const REPO_NAME = "matrix-test-clone";
// Default clone target based on server config reposPath
const CLONE_TARGET = `/Users/metajs/Projects/repos/${REPO_NAME}`;

describe("添加仓库 — Clone from URL", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Clean up leftover state from previous tests
    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    // Remove previously cloned directory to avoid git clone exit 128
    await rm(CLONE_TARGET, { recursive: true, force: true }).catch(() => {});
  });

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    await rm(CLONE_TARGET, { recursive: true, force: true }).catch(() => {});
  });

  it("克隆远程仓库，完成后出现在 sidebar", async () => {
    await cloneFromUrl(bridge, TEST_REPO_URL);

    // Wait for the repo to appear in sidebar (clone may take time)
    await waitFor(`[data-testid="repo-item-${REPO_NAME}"]`, { timeout: 30_000 });
  });
});
