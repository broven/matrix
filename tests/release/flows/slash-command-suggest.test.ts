import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, count, typeChar, type as typeText } from "../lib/ui";
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

    // The agent's available_commands_update may still be propagating.
    // Retry: focus → clear → type "/" → check for dropdown.
    const deadline = Date.now() + 15_000;
    let dropdownVisible = false;

    while (Date.now() < deadline) {
      // Ensure focus on chat input
      await bridge.eval(`document.querySelector('[data-testid="chat-input"]')?.focus()`);
      await new Promise((r) => setTimeout(r, 200));

      // Clear input and type "/"
      await typeText('[data-testid="chat-input"]', "/");
      await new Promise((r) => setTimeout(r, 500));

      // Check if dropdown appeared
      const visible = await bridge.eval(
        `!!document.querySelector('[data-testid="slash-command-dropdown"]')`,
      );
      if (visible) {
        dropdownVisible = true;
        break;
      }

      // Clear input for next attempt
      await typeText('[data-testid="chat-input"]', "");
      await new Promise((r) => setTimeout(r, 1_000));
    }

    if (!dropdownVisible) {
      throw new Error("Slash command dropdown did not appear after retries (available_commands may not have arrived)");
    }

    // Verify at least one command item is visible
    const itemCount = await count('[data-testid^="slash-command-item-"]');
    if (itemCount === 0) {
      throw new Error("Dropdown appeared but contains no command items");
    }
  });
});
