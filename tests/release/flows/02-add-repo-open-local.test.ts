import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge } from "../lib/ui";
import { addLocalRepo, repoExists } from "../lib/flows/repository";
import { expectVisible } from "../lib/assertions";

describe("02 — Add Repository (Open Local)", () => {
  let bridge: BridgeClient;
  let tempDir: string;
  const repoName = "test-local-repo";

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Create a temp git repo
    tempDir = await mkdtemp(join(tmpdir(), "matrix-release-test-"));
    const repoPath = join(tempDir, repoName);
    execSync(`mkdir -p ${repoPath} && cd ${repoPath} && git init && git commit --allow-empty -m "init"`, {
      stdio: "pipe",
    });
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should add a local repository via the Open Project dialog", async () => {
    const repoPath = join(tempDir, repoName);
    await addLocalRepo(bridge, repoPath, { name: repoName });
    await expectVisible(`[data-testid="repo-item-${repoName}"]`);
  });

  it("should show the repo in the sidebar after adding", async () => {
    const exists = await repoExists(repoName);
    expect(exists).toBe(true);
  });
});
