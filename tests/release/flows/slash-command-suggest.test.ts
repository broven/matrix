import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, count, typeChar } from "../lib/ui";
import { resetUI, ensureWorktree, removeAllRepos, spawnAgentViaMessage } from "../lib/flows/setup";

describe("Slash command 下拉提示", () => {
  let bridge: BridgeClient;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    const wt = await ensureWorktree(bridge);
    repoPath = wt.repoPath;

    // Spawn agent by sending a message (lazy init)
    await spawnAgentViaMessage(bridge);
  }, 120_000);

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("输入 / 后弹出 slash command 下拉提示", async () => {
    await waitFor('[data-testid="chat-input"]');

    // Type "/" into the chat input
    await typeChar('[data-testid="chat-input"]', "/");

    // Wait for dropdown to appear
    await waitFor('[data-testid="slash-command-dropdown"]', { timeout: 5_000 });

    // Verify at least one command item is visible
    const itemCount = await count('[data-testid^="slash-command-item-"]');
    if (itemCount === 0) {
      throw new Error("Dropdown appeared but contains no command items");
    }
  });
});
