import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, isVisible } from "../lib/ui";
import { resetUI, ensureWorktree, removeAllRepos } from "../lib/flows/setup";

describe("Session 删除按钮可见", () => {
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

  it("worktree item 上的删除按钮始终可见", async () => {
    // Ensure the worktree item is rendered
    await waitFor('[data-testid^="worktree-item-"]');

    // The delete button should be visible without hover or right-click
    const visible = await isVisible('[data-testid="delete-worktree-btn"]');
    expect(visible).toBe(true);
  });
});
