import { mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { BridgeClient } from "../bridge-client";
import { click, waitFor, isVisible, type as typeText } from "../ui";
import { addLocalRepo } from "./repository";

interface SidecarInfo {
  url: string;
  token: string;
}

/** Get sidecar URL and auth token from the bridge. */
async function getSidecarInfo(bridge: BridgeClient): Promise<SidecarInfo> {
  const state = await bridge.state();
  const port = (state.sidecar as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const authRes = await fetch(`${url}/api/auth-info`);
  const { token } = (await authRes.json()) as { token: string };
  return { url, token };
}

/**
 * Wait for the webview to become responsive (retries on 408 timeout).
 * Previous test cleanup can leave the webview re-rendering.
 */
async function waitForWebview(bridge: BridgeClient): Promise<void> {
  for (let i = 0; i < 15; i++) {
    try {
      await bridge.eval("1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Webview not responsive after 15s");
}

/**
 * Dismiss any open overlays/dialogs and wait for the main sidebar to be ready.
 * Call at the start of each test's beforeAll to ensure clean UI state.
 */
export async function resetUI(bridge: BridgeClient): Promise<void> {
  // Wait for webview to be responsive first (previous test cleanup may cause re-renders)
  await waitForWebview(bridge);

  // Close settings overlay if open
  if (await isVisible('[data-testid="settings-overlay"]')) {
    await click('[aria-label="Close settings"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
  // Close NewWorktreeDialog if open (it doesn't respond to Escape, click backdrop)
  await bridge.eval(`
    (() => {
      const backdrop = document.querySelector('.fixed.inset-0.z-50');
      if (backdrop) backdrop.click();
    })()
  `).catch(() => {});
  // Dismiss any other open dialog by pressing Escape
  await bridge.eval(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `).catch(() => {});
  // Wait for sidebar to be interactive
  await waitFor('[data-testid="add-repo-btn"]', { timeout: 10_000 });
}

/**
 * Create a temporary git repo on disk and add it to the app via the UI.
 * Returns the repo name (dirname) and path (realpath-resolved).
 */
export async function ensureRepo(
  bridge: BridgeClient,
): Promise<{ name: string; path: string }> {
  const raw = await mkdtemp(join(tmpdir(), "matrix-test-"));
  // Resolve symlinks (macOS /var -> /private/var) to match server-stored paths
  const tempDir = await realpath(raw);
  const name = tempDir.split("/").pop()!;
  execSync("git init", { cwd: tempDir, stdio: "pipe" });
  execSync('git commit --allow-empty -m "init"', { cwd: tempDir, stdio: "pipe" });
  await addLocalRepo(bridge, tempDir, { name });
  return { name, path: tempDir };
}

/**
 * Create a repo + worktree + session via the UI.
 * Returns repo info and the branch name used.
 */
export async function ensureWorktree(
  bridge: BridgeClient,
): Promise<{ repoName: string; repoPath: string; branch: string }> {
  const { name, path } = await ensureRepo(bridge);
  const branch = `test-branch-${Date.now()}`;

  // Click on the repo to expand it
  await click(`[data-testid="repo-item-${name}"]`);
  // Wait for new-session-btn scoped to THIS repo's item
  await waitFor(`[data-testid="repo-item-${name}"] [data-testid="new-session-btn"]`);

  // Click new worktree button scoped to THIS repo
  await click(`[data-testid="repo-item-${name}"] [data-testid="new-session-btn"]`);

  // Fill in the dialog
  await waitFor('[data-testid="worktree-branch-input"]');
  await typeText('[data-testid="worktree-branch-input"]', branch);

  // Create
  await click('[data-testid="create-worktree-btn"]');

  // Wait for session to be ready
  await waitFor('[data-testid="chat-input"]', { timeout: 45_000 });

  return { repoName: name, repoPath: path, branch };
}

/** Remove a specific repo (and its worktrees) via the sidecar API. */
export async function removeRepoById(
  bridge: BridgeClient,
  repoId: string,
): Promise<void> {
  const { url, token } = await getSidecarInfo(bridge);

  // Delete worktrees first
  const wtRes = await fetch(`${url}/repositories/${repoId}/worktrees`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (wtRes.ok) {
    const worktrees = (await wtRes.json()) as { id: string }[];
    for (const wt of worktrees) {
      await fetch(`${url}/worktrees/${wt.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }

  await fetch(`${url}/repositories/${repoId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

/** Remove all repos (and their worktrees) from the sidecar DB. */
export async function removeAllRepos(bridge: BridgeClient): Promise<void> {
  const { url, token } = await getSidecarInfo(bridge);
  const res = await fetch(`${url}/repositories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const repos = (await res.json()) as { id: string }[];
    for (const repo of repos) {
      await removeRepoById(bridge, repo.id);
    }
  }
}

/** Find a repo ID by name via sidecar API. */
export async function findRepoByName(
  bridge: BridgeClient,
  name: string,
): Promise<string | null> {
  const { url, token } = await getSidecarInfo(bridge);
  const res = await fetch(`${url}/repositories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const repos = (await res.json()) as { id: string; name: string }[];
  const repo = repos.find((r) => r.name === name);
  return repo?.id ?? null;
}

/** Open the settings overlay. */
export async function openSettings(): Promise<void> {
  await click('[data-testid="settings-btn"]');
  await waitFor('[data-testid="settings-overlay"]');
}

/** Close the settings overlay. */
export async function closeSettings(): Promise<void> {
  await click('[aria-label="Close settings"]');
  // Best-effort wait for overlay to disappear
  await new Promise((r) => setTimeout(r, 500));
}
