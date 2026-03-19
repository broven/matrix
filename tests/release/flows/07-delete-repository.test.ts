import { describe, it, expect, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, waitForGone, isVisible } from "../lib/ui";
import { deleteSession } from "../lib/flows/repository";

describe("07 — Delete Repository", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should delete a worktree via the context menu", async () => {
    // Assert that a worktree or legacy session item exists from prior tests
    const hasWorktree = await isVisible('[data-testid^="worktree-item-"]');
    expect(hasWorktree, "Expected at least one worktree item to exist from prior tests").toBe(true);

    // Trigger the context menu by right-clicking a worktree item
    await bridge.eval(`
      (() => {
        const item = document.querySelector('[data-testid^="worktree-item-"]');
        if (!item) return;
        const rect = item.getBoundingClientRect();
        item.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      })()
    `);

    // Wait for delete option to appear
    await waitFor('[data-testid="delete-repo-option"]', { timeout: 5_000 });

    await deleteSession(bridge);

    // Verify the confirmation is dismissed
    await waitForGone('[data-testid="confirm-delete-btn"]', { timeout: 5_000 });
  });
});
