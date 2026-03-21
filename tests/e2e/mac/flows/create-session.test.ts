import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, type as typeText, waitFor } from "../lib/ui";
import { resetUI, ensureRepo, removeAllRepos } from "../lib/flows/setup";

describe("创建 Worktree Session", () => {
  let bridge: BridgeClient;
  let repoName: string;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    const repo = await ensureRepo(bridge);
    repoName = repo.name;
    repoPath = repo.path;
  });

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("创建 worktree + session，聊天界面加载出来", async () => {
    // Click on the repo to expand it (so new-session-btn appears)
    await click(`[data-testid="repo-item-${repoName}"]`);
    await waitFor('[data-testid="new-session-btn"]');

    // Click new worktree button
    await click('[data-testid="new-session-btn"]');

    // Fill in the New Worktree dialog
    await waitFor('[data-testid="worktree-branch-input"]');
    await typeText('[data-testid="worktree-branch-input"]', `test-branch-${Date.now()}`);

    // Click Create Worktree
    await click('[data-testid="create-worktree-btn"]');

    // Wait for the chat interface to appear (agent needs time to start)
    await waitFor('[data-testid="chat-input"]', { timeout: 45_000 });
  });
});
