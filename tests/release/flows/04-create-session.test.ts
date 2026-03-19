import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, type as typeText, waitFor } from "../lib/ui";
import { expectVisible } from "../lib/assertions";

describe("04 — Create Session", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open a new session with chat input ready", async () => {
    // Click the new session/worktree button (visible on repo header)
    await waitFor('[data-testid="new-session-btn"]');
    await click('[data-testid="new-session-btn"]');

    // Fill in the New Worktree dialog
    await waitFor('[data-testid="worktree-branch-input"]');
    await typeText('[data-testid="worktree-branch-input"]', `test-branch-${Date.now()}`);

    // Click Create Worktree
    await click('[data-testid="create-worktree-btn"]');

    // Wait for the chat interface to appear
    await waitFor('[data-testid="chat-input"]', { timeout: 30_000 });
    await expectVisible('[data-testid="chat-input"]');
    await expectVisible('[data-testid="send-btn"]');
  });
});
