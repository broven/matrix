import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, type as typeText, waitFor } from "../lib/ui";
import { resetUI, removeAllRepos, openSettings, closeSettings, sendMessage } from "../lib/flows/setup";
import { startSecondServer, type SecondServer } from "../lib/second-server";

/**
 * Remove all remote (non-sidecar) servers via the Settings UI.
 * Must be called while settings overlay is open.
 */
async function removeAllRemoteServers(bridge: BridgeClient): Promise<void> {
  for (let round = 0; round < 10; round++) {
    // Find a non-sidecar server tab
    const tabs = (await bridge.eval(`
      Array.from(document.querySelectorAll('[data-testid^="settings-server-tab-"]'))
        .map(el => el.getAttribute('data-testid'))
        .filter(id => id !== 'settings-server-tab-__sidecar__')
    `)) as string[];

    if (!tabs || tabs.length === 0) break;

    // Click the first remote server tab
    await click(`[data-testid="${tabs[0]}"]`);
    await waitFor('[data-testid="server-delete-btn"]');

    // Click "Remove Server"
    await click('[data-testid="server-delete-btn"]');
    await waitFor('[data-testid="server-confirm-delete-btn"]');

    // Click "Confirm"
    await click('[data-testid="server-confirm-delete-btn"]');
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe("多服务器：添加远程服务器、创建仓库和会话", () => {
  let bridge: BridgeClient;
  let secondServer: SecondServer;
  let repoName: string;
  let repoPath: string;

  beforeAll(async () => {
    bridge = createBridgeClient();
    setBridge(bridge);

    // Start a second Matrix server
    secondServer = await startSecondServer();

    // Clean up any existing remote servers from previous test runs via UI
    await resetUI(bridge);
    await openSettings();
    await removeAllRemoteServers(bridge);
    await closeSettings();

    await removeAllRepos(bridge).catch(() => {});
  }, 120_000);

  afterAll(async () => {
    // Clean up remote server repos
    if (secondServer) {
      const repos = (await secondServer.request("GET", "/repositories").catch(() => [])) as { id: string }[];
      for (const repo of repos) {
        const wts = (await secondServer.request("GET", `/repositories/${repo.id}/worktrees`).catch(() => [])) as { id: string }[];
        for (const wt of wts) {
          await secondServer.request("DELETE", `/worktrees/${wt.id}`).catch(() => {});
        }
        await secondServer.request("DELETE", `/repositories/${repo.id}`).catch(() => {});
      }
    }

    // Remove the remote server from settings via UI
    try {
      await resetUI(bridge);
      await openSettings();
      await removeAllRemoteServers(bridge);
      await closeSettings();
    } catch {
      // Best effort
    }

    // Shut down second server
    if (secondServer) {
      await secondServer.teardown();
    }

    // Clean up temp repo
    if (repoPath) {
      const { rm } = await import("node:fs/promises");
      await rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("通过 Settings 添加远程服务器，连接成功", async () => {
    // Open settings
    await openSettings();

    // Click "Add Server..." in the settings sidebar
    await waitFor('[data-testid="settings-add-server-btn"]');
    await click('[data-testid="settings-add-server-btn"]');

    // Wait for new server form
    await waitFor('[data-testid="settings-new-server"]');

    // Fill in server details
    await typeText('[data-testid="new-server-name-input"]', "Test Remote");
    await typeText('[data-testid="new-server-url-input"]', secondServer.baseUrl);
    await typeText('[data-testid="new-server-token-input"]', secondServer.token);

    // Click Save & Connect
    await click('[data-testid="new-server-save-btn"]');

    // After successful connection, the UI navigates to the server detail page.
    // The status text is lowercase "connected" (CSS text-capitalize makes it look uppercase).
    await bridge.wait(
      {
        kind: "webview.eval",
        script: `
          (() => {
            const detail = document.querySelector('[data-testid="settings-server-detail"]');
            if (!detail) return false;
            return detail.textContent.includes('connected');
          })()
        `,
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    );
  });

  it("远程服务器在 Settings 侧边栏中展示", async () => {
    // The settings sidebar should show the new server tab (non-sidecar)
    await bridge.wait(
      {
        kind: "webview.eval",
        script: `!!document.querySelector('[data-testid^="settings-server-tab-"]:not([data-testid="settings-server-tab-__sidecar__"])')`,
      },
      { timeoutMs: 10_000, intervalMs: 500 },
    );

    // Close settings
    await closeSettings();
  });

  it("远程服务器在主侧边栏中展示且已连接", async () => {
    // The main sidebar should show at least 2 server sections (sidecar + remote)
    await bridge.wait(
      {
        kind: "webview.eval",
        script: `document.querySelectorAll('[data-testid^="server-section-"]').length >= 2`,
      },
      { timeoutMs: 10_000, intervalMs: 500 },
    );

    // The remote server section should have a green status dot (connected)
    const remoteConnected = await bridge.eval(`
      (() => {
        const sections = document.querySelectorAll('[data-testid^="server-section-"]');
        for (const section of sections) {
          if (section.getAttribute('data-testid') === 'server-section-__sidecar__') continue;
          const dot = section.querySelector('[data-testid="server-status-dot"]');
          if (dot && dot.classList.contains('bg-success')) return true;
        }
        return false;
      })()
    `);
    if (!remoteConnected) {
      throw new Error("Remote server section not showing connected status");
    }
  });

  it("在远程服务器上添加仓库，sidebar 中展示", async () => {
    // Create a temp git repo on disk
    const raw = await mkdtemp(join(tmpdir(), "matrix-remote-repo-"));
    repoPath = await realpath(raw);
    repoName = repoPath.split("/").pop()!;
    execSync("git init", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit --allow-empty -m "init"', { cwd: repoPath, stdio: "pipe" });

    // Add repo to the remote server via its API
    await secondServer.request("POST", "/repositories", {
      path: repoPath,
      name: repoName,
    });

    // Wait for the repo to appear in the sidebar under the remote server section
    await waitFor(`[data-testid="repo-item-${repoName}"]`, { timeout: 15_000 });
  });

  it("在远程服务器上创建 worktree + session，聊天界面加载", async () => {
    const branch = `test-remote-${Date.now()}`;

    // Click on the repo to expand it
    await click(`[data-testid="repo-item-${repoName}"]`);
    await waitFor(`[data-testid="repo-item-${repoName}"] [data-testid="new-session-btn"]`);

    // Click new worktree button
    await click(`[data-testid="repo-item-${repoName}"] [data-testid="new-session-btn"]`);

    // Fill in the New Worktree dialog
    await waitFor('[data-testid="worktree-branch-input"]');
    await typeText('[data-testid="worktree-branch-input"]', branch);

    // Click Create
    await click('[data-testid="create-worktree-btn"]');

    // Wait for the chat interface to appear
    await waitFor('[data-testid="chat-input"]', { timeout: 45_000 });
  });

  it("在远程服务器的 session 中能正常对话", async () => {
    // Send a message
    await sendMessage(bridge, "hello from remote server test");

    // Wait for agent response
    await bridge.wait(
      {
        kind: "webview.eval",
        script: `!!document.querySelector('[data-testid="assistant-message"]')`,
      },
      { timeoutMs: 90_000, intervalMs: 1_000 },
    );
  });
});
