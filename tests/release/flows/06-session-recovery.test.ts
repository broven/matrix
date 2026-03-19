import { describe, it, beforeAll, expect } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor, count } from "../lib/ui";

describe("06 — Session Recovery", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should recover messages after page reload", async () => {
    // Ensure we're in a session with messages
    await waitFor('[data-testid="chat-input"]');

    // Record current message count
    const userCount = await count('[data-testid="message-item"]');
    const assistantCount = await count('[data-testid="assistant-message"]');
    const countBefore = userCount + assistantCount;

    // Reload the webview
    await bridge.invoke("window.reload");

    // Wait for the app to recover
    await waitFor('[data-testid="chat-input"]', { timeout: 15_000 });

    // If there were messages, poll until they're restored
    if (countBefore > 0) {
      await bridge.wait(
        {
          kind: "webview.eval",
          script: `(document.querySelectorAll('[data-testid="message-item"]').length + document.querySelectorAll('[data-testid="assistant-message"]').length) >= ${countBefore}`,
        },
        { timeoutMs: 10_000, intervalMs: 500 },
      );
      const userAfter = await count('[data-testid="message-item"]');
      const assistantAfter = await count('[data-testid="assistant-message"]');
      expect(userAfter + assistantAfter).toBeGreaterThanOrEqual(countBefore);
    }
  });
});
