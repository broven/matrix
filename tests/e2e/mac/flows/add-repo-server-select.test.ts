import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, isVisible, type as typeText } from "../lib/ui";
import { resetUI, removeAllRepos, openSettings, closeSettings, findRepoByName } from "../lib/flows/setup";
import { startSecondServer, type SecondServer } from "../lib/second-server";

/**
 * Remove all remote (non-sidecar) servers via the Settings UI.
 * Must be called while the settings overlay is open.
 */
async function removeAllRemoteServers(bridge: BridgeClient): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const tabs = (await bridge.eval(`
      Array.from(document.querySelectorAll('[data-testid^="settings-server-tab-"]'))
        .map(el => el.getAttribute('data-testid'))
        .filter(id => id !== 'settings-server-tab-__sidecar__')
    `)) as string[];

    if (!tabs || tabs.length === 0) break;

    await click(`[data-testid="${tabs[0]}"]`);
    await waitFor('[data-testid="server-delete-btn"]');
    await click('[data-testid="server-delete-btn"]');
    await waitFor('[data-testid="server-confirm-delete-btn"]');
    await click('[data-testid="server-confirm-delete-btn"]');
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Connect a second server via the Settings UI.
 */
async function connectSecondServerViaUI(
  bridge: BridgeClient,
  server: SecondServer,
): Promise<void> {
  await openSettings();

  await waitFor('[data-testid="settings-add-server-btn"]');
  await click('[data-testid="settings-add-server-btn"]');
  await waitFor('[data-testid="settings-new-server"]');

  await typeText('[data-testid="new-server-name-input"]', "Test Remote");
  await typeText('[data-testid="new-server-url-input"]', server.baseUrl);
  await typeText('[data-testid="new-server-token-input"]', server.token);

  await click('[data-testid="new-server-save-btn"]');

  // Wait until status shows "connected"
  await bridge.wait(
    {
      kind: "webview.eval",
      script: `
        (() => {
          const detail = document.querySelector('[data-testid="settings-server-detail"]');
          return detail?.textContent?.includes('connected') ?? false;
        })()
      `,
    },
    { timeoutMs: 30_000, intervalMs: 500 },
  );

  await closeSettings();

  // Wait for the remote server section to appear in the main sidebar
  await bridge.wait(
    {
      kind: "webview.eval",
      script: `document.querySelectorAll('[data-testid^="server-section-"]').length >= 2`,
    },
    { timeoutMs: 15_000, intervalMs: 500 },
  );
}

describe("Add Repository — 服务器选择", () => {
  let bridge: BridgeClient;
  let secondServer: SecondServer;
  let repoPath: string;
  let repoName: string;

  beforeAll(async () => {
    bridge = createBridgeClient();
    setBridge(bridge);

    await resetUI(bridge);
    await openSettings();
    await removeAllRemoteServers(bridge);
    await closeSettings();
    await removeAllRepos(bridge).catch(() => {});
  }, 120_000);

  afterAll(async () => {
    // Clean up remote repos
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

    // Remove remote server via UI
    try {
      await resetUI(bridge);
      await openSettings();
      await removeAllRemoteServers(bridge);
      await closeSettings();
    } catch {
      // Best effort
    }

    if (secondServer) {
      await secondServer.teardown();
    }

    if (repoPath) {
      await rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("单服务器时，Open Project 对话框不展示 server-select", async () => {
    // Open the Add Repository dropdown
    await click('[data-testid="add-repo-btn"]');
    await waitFor('[data-testid="open-local-option"]');
    await click('[data-testid="open-local-option"]');
    await waitFor('[data-testid="path-input"]');

    // Server select should NOT be visible with only sidecar connected
    const shown = await isVisible('[data-testid="server-select"]');
    if (shown) {
      throw new Error("server-select should not be visible when only one server is connected");
    }

    // Close the dialog (use backdrop click — JSC doesn't support bare semicolons in eval)
    await bridge.eval(`
      (() => {
        const backdrop = document.querySelector('.fixed.inset-0.z-50');
        if (backdrop) backdrop.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
  });

  it("连接第二个服务器后，Open Project 对话框展示 server-select", async () => {
    secondServer = await startSecondServer();
    await connectSecondServerViaUI(bridge, secondServer);

    // Open the dialog
    await click('[data-testid="add-repo-btn"]');
    await waitFor('[data-testid="open-local-option"]');
    await click('[data-testid="open-local-option"]');
    await waitFor('[data-testid="path-input"]');

    // Server select SHOULD now be visible
    await waitFor('[data-testid="server-select"]');

    // Close the dialog (use backdrop click — JSC doesn't support bare semicolons in eval)
    await bridge.eval(`
      (() => {
        const backdrop = document.querySelector('.fixed.inset-0.z-50');
        if (backdrop) backdrop.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
  }, 120_000);

  it("选择远程服务器，通过 Open Project 添加 repo，repo 出现在远程服务器上", async () => {
    // Create a temp git repo on disk (accessible from both servers)
    const raw = await mkdtemp(join(tmpdir(), "matrix-server-select-repo-"));
    repoPath = await realpath(raw);
    repoName = repoPath.split("/").pop()!;
    execSync("git init", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit --allow-empty -m "init"', { cwd: repoPath, stdio: "pipe" });

    // Open Add Repository → Open Project
    await click('[data-testid="add-repo-btn"]');
    await waitFor('[data-testid="open-local-option"]');
    await click('[data-testid="open-local-option"]');
    await waitFor('[data-testid="path-input"]');
    await waitFor('[data-testid="server-select"]');

    // Click the server-select trigger to open the dropdown
    await click('[data-testid="server-select"]');

    // Wait for non-sidecar option to appear and click it
    await waitFor('[data-testid^="server-option-"]:not([data-testid="server-option-__sidecar__"])');
    await click('[data-testid^="server-option-"]:not([data-testid="server-option-__sidecar__"])');

    // Wait a moment for the selection to register
    await new Promise((r) => setTimeout(r, 300));

    // Type the repo path
    await typeText('[data-testid="path-input"]', repoPath);
    await new Promise((r) => setTimeout(r, 500));

    // Click confirm
    await click('[data-testid="confirm-btn"]');

    // Wait for repo to appear in sidebar
    await waitFor(`[data-testid="repo-item-${repoName}"]`, { timeout: 15_000 });

    // Verify the repo is on the remote server via API
    const remoteRepos = (await secondServer.request("GET", "/repositories")) as { id: string; name: string }[];
    const onRemote = remoteRepos.some((r) => r.name === repoName);
    if (!onRemote) {
      throw new Error(
        `Repo "${repoName}" not found on remote server. Remote repos: ${JSON.stringify(remoteRepos.map((r) => r.name))}`,
      );
    }

    // Verify the repo is NOT on the sidecar
    const sidecarRepoId = await findRepoByName(bridge, repoName);
    if (sidecarRepoId !== null) {
      throw new Error(`Repo "${repoName}" should NOT be on sidecar, but was found with id=${sidecarRepoId}`);
    }
  }, 60_000);
});
