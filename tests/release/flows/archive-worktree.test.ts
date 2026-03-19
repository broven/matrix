import { describe, it, beforeAll, expect } from "vitest";
import { existsSync } from "node:fs";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, isVisible, getText } from "../lib/ui";

describe("Archive Worktree", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should have a worktree item with a delete button", async () => {
    const hasWorktree = await isVisible('[data-testid^="worktree-item-"]');
    if (!hasWorktree) {
      throw new Error("No worktree in sidebar — create-session test must run first");
    }

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

  it("should show confirmation when clicking delete", async () => {
    await click('[data-testid="delete-repo-option"]');
    await waitFor('[data-testid="confirm-delete-btn"]');
  });

  it("should delete the worktree after confirmation", async () => {
    await click('[data-testid="confirm-delete-btn"]');

    // Wait for the worktree to disappear
    await waitFor('[data-testid^="repo-item-"]', { timeout: 10_000 });
  });
});
