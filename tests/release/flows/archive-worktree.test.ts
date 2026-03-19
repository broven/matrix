import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor } from "../lib/ui";
import { resetUI, ensureWorktree, removeAllRepos } from "../lib/flows/setup";

describe("归档 Worktree", () => {
  let bridge: BridgeClient;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    const wt = await ensureWorktree(bridge);
    repoPath = wt.repoPath;
  });

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("右键 worktree 显示删除选项", async () => {
    // Right-click the worktree to show context menu
    await bridge.eval(`
      (function(){
        var el = document.querySelector('[data-testid^="worktree-item-"]');
        el.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 100, clientY: 200}));
        return 'ok';
      })()
    `);

    await waitFor('[data-testid="delete-repo-option"]');
  });

  it("点击删除后弹出确认对话框", async () => {
    await click('[data-testid="delete-repo-option"]');
    await waitFor('[data-testid="confirm-delete-btn"]');
  });

  it("确认后 worktree 被删除", async () => {
    await click('[data-testid="confirm-delete-btn"]');

    // Wait for the worktree to disappear
    await waitFor('[data-testid^="repo-item-"]', { timeout: 10_000 });
  });
});
