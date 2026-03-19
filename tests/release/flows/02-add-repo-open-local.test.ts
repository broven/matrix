import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { addLocalRepo, repoExists } from "../lib/flows/repository";
import { expectVisible } from "../lib/assertions";

const TEST_REPO_URL = "https://github.com/broven/matrix-test-local.git";
const REPO_NAME = "matrix-test-local";

describe("02 — Add Repository (Open Local)", () => {
  let bridge: BridgeClient;
  let cloneDir: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Clone the test repo to a temp directory with the expected name
    const parentDir = join(tmpdir(), `matrix-release-test-${Date.now()}`);
    cloneDir = join(parentDir, REPO_NAME);
    execSync(`mkdir -p ${parentDir} && git clone ${TEST_REPO_URL} ${cloneDir}`, { stdio: "pipe" });
  });

  afterAll(async () => {
    if (cloneDir) {
      await rm(cloneDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("should add a local repository via the Open Project dialog", async () => {
    await addLocalRepo(bridge, cloneDir, { name: REPO_NAME });
    await expectVisible(`[data-testid="repo-item-${REPO_NAME}"]`);
  });

  it("should show the repo in the sidebar after adding", async () => {
    const exists = await repoExists(REPO_NAME);
    expect(exists).toBe(true);
  });
});
