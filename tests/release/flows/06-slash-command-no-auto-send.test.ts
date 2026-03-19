import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitForGone, isVisible, getValue } from "../lib/ui";

describe("06 — Selecting a slash command inserts it without sending", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should insert command into input without auto-sending", async () => {
    // Ensure dropdown is open (from test 05)
    const hasDropdown = await isVisible('[data-testid="slash-command-dropdown"]');
    if (!hasDropdown) {
      throw new Error("No slash command dropdown — test 05 must run first");
    }

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
