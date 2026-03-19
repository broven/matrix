import type { BridgeClient } from "../bridge-client";
import { click, type as typeText, waitFor, getText, count } from "../ui";

/**
 * Create a new session/worktree for a repository.
 */
export async function createSession(
  bridge: BridgeClient,
  repoName: string,
): Promise<void> {
  // Click the new session button on the repo item
  // First hover the repo to reveal the button (simulate via click on repo)
  await click(`[data-testid="repo-item-${repoName}"]`);
  await click('[data-testid="new-session-btn"]');

  // Wait for the chat interface to appear
  await waitFor('[data-testid="chat-input"]', { timeout: 15_000 });
}

/**
 * Send a prompt and wait for the response.
 */
export async function sendPrompt(
  bridge: BridgeClient,
  text: string,
): Promise<void> {
  await waitFor('[data-testid="chat-input"]');
  await typeText('[data-testid="chat-input"]', text);
  await click('[data-testid="send-btn"]');
}

/**
 * Wait for an assistant response to appear.
 */
export async function waitForAssistantResponse(
  opts?: { timeout?: number },
): Promise<void> {
  await waitFor('[data-testid="assistant-message"]', {
    timeout: opts?.timeout ?? 30_000,
  });
}

/**
 * Get the text of the last assistant message.
 */
export async function getLastAssistantMessage(): Promise<string> {
  // Get all assistant messages and return the last one's text
  const result = await getText('[data-testid="assistant-message"]:last-of-type');
  return result;
}

/**
 * Get the count of message items (both user and assistant).
 */
export async function getMessageCount(): Promise<number> {
  const userCount = await count('[data-testid="message-item"]');
  const assistantCount = await count('[data-testid="assistant-message"]');
  return userCount + assistantCount;
}
