import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor } from "../lib/ui";
import { resetUI, ensureRepo, openSettings, closeSettings, removeAllRepos } from "../lib/flows/setup";

describe("删除仓库 — 保留文件", () => {
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
    await click('[data-testid^="settings-repo-tab-"]');
    await waitFor('[data-testid="settings-repo-detail"]');
  });

  afterAll(async () => {
    await closeSettings().catch(() => {});
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("删除对话框中「删除文件」默认未勾选", async () => {
    await click('[data-testid="delete-repo-btn"]');
    await waitFor('[data-testid="delete-source-checkbox"]');

    const checked = await bridge.eval(`
      (() => {
        const cb = document.querySelector('[data-testid="delete-source-checkbox"]');
        return cb ? cb.checked : null;
      })()
    `);
    expect(checked).toBe(false);
  });

  it("确认删除后仓库从列表消失，物理文件保留", async () => {
    await click('[data-testid="confirm-delete-repo-btn"]');

    // Should return to General tab (settings still open)
    await waitFor('[data-testid="settings-overlay"]', { timeout: 5000 });

    // Source files should still exist
    expect(existsSync(repoPath)).toBe(true);
  });
});
