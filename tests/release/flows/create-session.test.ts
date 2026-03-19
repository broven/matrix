import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, type as typeText, waitFor, isVisible } from "../lib/ui";
import { expectVisible } from "../lib/assertions";

describe("Create Session", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open a new session with chat input ready", async () => {
    // Ensure at least one repo exists (from tests 02/03)
    const hasRepo = await isVisible('[data-testid^="repo-item-"]');
    if (!hasRepo) {
      throw new Error("No repo in sidebar — tests 02/03 must run first");
    }

    // Click on a repo to expand it (so new-session-btn appears)
    await click('[data-testid^="repo-item-"]');
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
