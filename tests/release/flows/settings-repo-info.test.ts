import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, getText } from "../lib/ui";
import { expectVisible } from "../lib/assertions";
import { resetUI, ensureRepo, removeAllRepos, openSettings, closeSettings } from "../lib/flows/setup";

describe("Settings — 仓库信息展示", () => {
  let bridge: BridgeClient;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    const repo = await ensureRepo(bridge);
    repoPath = repo.path;

    await openSettings();
  });

  afterAll(async () => {
    await closeSettings().catch(() => {});
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("Settings 全屏打开", async () => {
    await expectVisible('[data-testid="settings-overlay"]');
  });

  it("侧边栏显示仓库 tab", async () => {
    await expectVisible('[data-testid^="settings-repo-tab-"]');
  });

  it("点击仓库 tab 展示仓库详情", async () => {
    await click('[data-testid^="settings-repo-tab-"]');
    await waitFor('[data-testid="settings-repo-detail"]');

    const detail = await getText('[data-testid="settings-repo-detail"]');
    // Should contain path, default branch info
    expect(detail).toBeTruthy();
  });

  it("危险区域显示删除按钮", async () => {
    await expectVisible('[data-testid="delete-repo-btn"]');
  });
});
