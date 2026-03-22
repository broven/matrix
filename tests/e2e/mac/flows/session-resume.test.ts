import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, isVisible } from "../lib/ui";
import { resetUI, ensureWorktree, removeAllRepos, spawnAgentViaMessage } from "../lib/flows/setup";

/** Call server REST API directly from Node.js (same pattern as removeRepoById). */
async function serverFetch(bridge: BridgeClient, method: string, path: string): Promise<Response> {
  return fetch(`${bridge.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bridge.token}` },
  });
}

describe("Session Resume", () => {
  let bridge: BridgeClient;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await removeAllRepos(bridge).catch(() => {});

    const wt = await ensureWorktree(bridge);
    repoPath = wt.repoPath;

    // Spawn the agent so the session gets agentSessionId + recoverable
    await spawnAgentViaMessage(bridge);
  });

  afterAll(async () => {
    await removeAllRepos(bridge).catch(() => {});
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("关闭 session 后显示 Resume 按钮", async () => {
    // Find the active session via server API
    const res = await serverFetch(bridge, "GET", "/sessions");
    const sessions = (await res.json()) as Array<{ sessionId: string; status: string }>;
    const activeSession = sessions.find((s) => s.status === "active");
    expect(activeSession).toBeDefined();

    // Soft-close the session via API
    const closeRes = await serverFetch(bridge, "POST", `/sessions/${activeSession!.sessionId}/close`);
    expect(closeRes.status).toBe(200);

    // Wait for the UI to reflect the closed state — resume button should appear
    await waitFor('[data-testid="resume-session-btn"]', { timeout: 10_000 });

    // chat-input should be hidden when closed
    const hasInput = await isVisible('[data-testid="chat-input"]');
    expect(hasInput).toBe(false);
  });

  it("点击 Resume 后恢复会话，chat-input 重新可用", async () => {
    // Click the resume button
    await click('[data-testid="resume-session-btn"]');

    // Wait for the session to become active — chat input reappears
    await waitFor('[data-testid="chat-input"]', { timeout: 30_000 });

    // Resume button should disappear
    const hasResumeBtn = await isVisible('[data-testid="resume-session-btn"]');
    expect(hasResumeBtn).toBe(false);
  });
});
