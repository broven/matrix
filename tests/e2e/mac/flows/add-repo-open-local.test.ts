import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { addLocalRepo, repoExists } from "../lib/flows/repository";
import { expectVisible } from "../lib/assertions";
import { resetUI, removeAllRepos } from "../lib/flows/setup";

const TEST_REPO_URL = "https://github.com/broven/matrix-test-local.git";
const REPO_NAME = "matrix-test-local";

describe("添加仓库 — Open Project", () => {
  let bridge: BridgeClient;
  let cloneDir: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Clean up leftover state from previous tests
    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    // Clone the test repo to a temp directory with the expected name
    const parentDir = join(tmpdir(), `matrix-release-test-${Date.now()}`);
    cloneDir = join(parentDir, REPO_NAME);
    execSync(`mkdir -p ${parentDir} && git clone ${TEST_REPO_URL} ${cloneDir}`, { stdio: "pipe" });
  });

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    if (cloneDir) {
      await rm(cloneDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("通过 Open Project 对话框添加本地 git 仓库", async () => {
    await addLocalRepo(bridge, cloneDir, { name: REPO_NAME });
    await expectVisible(`[data-testid="repo-item-${REPO_NAME}"]`);
  });

  it("仓库出现在 sidebar", async () => {
    const exists = await repoExists(REPO_NAME);
    expect(exists).toBe(true);
  });
});
