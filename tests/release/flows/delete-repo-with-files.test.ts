import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor } from "../lib/ui";
import { addLocalRepo } from "../lib/flows/repository";
import { resetUI, closeSettings, removeAllRepos } from "../lib/flows/setup";

describe("删除仓库 — 连带删除文件", () => {
  let bridge: BridgeClient;
  let tempRepoPath: string;
  let repoName: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    // Create a temporary git repo to add and then delete
    // Resolve symlinks (macOS /var -> /private/var) so path matches what server stores
    const raw = await mkdtemp(join(tmpdir(), "matrix-delete-test-"));
    tempRepoPath = await realpath(raw);
    repoName = tempRepoPath.split("/").pop()!;
    execSync("git init", { cwd: tempRepoPath, stdio: "pipe" });
    execSync('git commit --allow-empty -m "init"', { cwd: tempRepoPath, stdio: "pipe" });
  });

  afterAll(async () => {
    await closeSettings().catch(() => {});
    await removeAllRepos(bridge).catch(() => {});
    if (tempRepoPath && existsSync(tempRepoPath)) {
      await rm(tempRepoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("添加临时仓库", async () => {
    await addLocalRepo(bridge, tempRepoPath);
    // Verify it appears (name derived from temp dir)
    await waitFor('[data-testid^="repo-item-"]', { timeout: 5000 });
  });

  it("打开 Settings 选中仓库", async () => {
    await click('[data-testid="settings-btn"]');
    await waitFor('[data-testid="settings-overlay"]');

    // Click the specific repo tab matching our temp repo
    await click(`[data-testid="settings-repo-tab-${repoName}"]`);
    await waitFor('[data-testid="settings-repo-detail"]');
  });

  it("勾选删除文件并确认", async () => {
    await click('[data-testid="delete-repo-btn"]');
    await waitFor('[data-testid="delete-source-checkbox"]');

    // Check the "delete source files" checkbox
    await click('[data-testid="delete-source-checkbox"]');

    // Confirm deletion
    await click('[data-testid="confirm-delete-repo-btn"]');

    // Should return to General tab
    await waitFor('[data-testid="settings-overlay"]', { timeout: 10_000 });
  });

  it("物理文件已被删除", async () => {
    // Poll until the server finishes deleting (async rm can take a few seconds)
    for (let i = 0; i < 15; i++) {
      if (!existsSync(tempRepoPath)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(existsSync(tempRepoPath)).toBe(false);
  });
});
