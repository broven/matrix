import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, isVisible, typeChar, count } from "../lib/ui";

describe("05 — Slash command dropdown appears when typing /", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should show slash command suggestions after typing /", async () => {
    // Ensure chat input is ready (from test 04)
    const hasInput = await isVisible('[data-testid="chat-input"]');
    if (!hasInput) {
      throw new Error("No chat input — test 04 must run first");
    }

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
