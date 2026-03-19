import { describe, it, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, waitForGone, isVisible, getValue, typeChar } from "../lib/ui";
import { resetUI, ensureWorktree, removeAllRepos } from "../lib/flows/setup";

describe("Slash command 选择后不自动发送", () => {
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

  it("选择一个 slash command 后仅填入输入框，不自动发送", async () => {
    await waitFor('[data-testid="chat-input"]');

    // Wait for availableCommands to arrive from the session
    await new Promise((r) => setTimeout(r, 2_000));

    // Type "/" to open dropdown
    await typeChar('[data-testid="chat-input"]', "/");
    await waitFor('[data-testid="slash-command-dropdown"]', { timeout: 5_000 });

    // mousedown on the first command item (dropdown uses onMouseDown, not onClick)
    await bridge.eval(`
      (() => {
        const el = document.querySelector('[data-testid^="slash-command-item-"]');
        if (!el) throw new Error('No slash command item found');
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      })()
    `);

    // Dropdown should close
    await waitForGone('[data-testid="slash-command-dropdown"]');

    // Input should contain the command text (e.g. "/compact ")
    const inputValue = await getValue('[data-testid="chat-input"]');
    if (!inputValue.startsWith("/")) {
      throw new Error(`Expected input to start with "/" but got: "${inputValue}"`);
    }

    // Verify message was NOT sent — no agent message should appear
    const hasAgentMessage = await isVisible('[data-testid="agent-message"]');
    if (hasAgentMessage) {
      throw new Error("Message was auto-sent after selecting command — should only insert");
    }
  });
});
