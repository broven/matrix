import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor } from "../lib/ui";
import { expectVisible } from "../lib/assertions";

describe("04 — Create Session", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open a new session with chat input ready", async () => {
    // Find a repo item and click it
    await waitFor('[data-testid^="repo-item-"]');
    await click('[data-testid^="repo-item-"]');

    // Click the new session/worktree button
    await waitFor('[data-testid="new-session-btn"]');
    await click('[data-testid="new-session-btn"]');

    // Wait for the chat interface to appear
    await waitFor('[data-testid="chat-input"]', { timeout: 15_000 });
    await expectVisible('[data-testid="chat-input"]');
    await expectVisible('[data-testid="send-btn"]');
  });
});
