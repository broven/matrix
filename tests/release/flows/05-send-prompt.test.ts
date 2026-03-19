import { describe, it, expect, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, waitFor } from "../lib/ui";
import { sendPrompt, waitForAssistantResponse, getLastAssistantMessage } from "../lib/flows/session";
import { expectVisible } from "../lib/assertions";

const REAL_AGENT = process.env.REAL_AGENT === "1";

describe.skipIf(!REAL_AGENT)("05 — Send Prompt & Receive Response (@real-agent)", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should send a prompt and receive an assistant response", async () => {
    // Ensure we have a chat input ready
    await waitFor('[data-testid="chat-input"]');

    // Send a simple prompt
    await sendPrompt(bridge, "Say hello and nothing else.");

    // Wait for the assistant to respond
    await waitForAssistantResponse({ timeout: 60_000 });
    await expectVisible('[data-testid="assistant-message"]');

    // Verify the response contains content
    const responseText = await getLastAssistantMessage();
    expect(responseText.length).toBeGreaterThan(0);
  });
});
