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

/** Remove all repos (and their worktrees) from the sidecar DB, then reload UI to sync. */
export async function removeAllRepos(bridge: BridgeClient): Promise<void> {
  const { url, token } = await getSidecarInfo(bridge);
  const res = await fetch(`${url}/repositories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let deleted = false;
  if (res.ok) {
    const repos = (await res.json()) as { id: string }[];
    for (const repo of repos) {
      await removeRepoById(bridge, repo.id);
    }
    if (repos.length > 0) deleted = true;
  }
  // Reload webview so UI reflects the clean state
  if (deleted) {
    await bridge.invoke("window.reload");
    // Brief pause so the old page tears down before we start polling
    await new Promise((r) => setTimeout(r, 1_500));
    await waitForWebview(bridge);
    await waitFor('[data-testid="add-repo-btn"]', { timeout: 15_000 });
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

/**
 * Send a chat message to trigger lazy agent spawn.
 * Uses React's _valueTracker trick + programmatic form submission.
 * Retries up to 3 times to handle timing issues with React state.
 */
export async function sendMessage(
  bridge: BridgeClient,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitFor('[data-testid="chat-input"]');

    // Set value using React-compatible approach
    await bridge.eval(`
      (() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        if (!el) throw new Error('chat-input not found');
        el.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeSetter.call(el, ${JSON.stringify(text)});
        const tracker = el._valueTracker;
        if (tracker) tracker.setValue('');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    // Wait for React to process the state change
    await new Promise((r) => setTimeout(r, 500));

    // Submit via Enter keydown
    await bridge.eval(`
      (() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        if (!el) throw new Error('chat-input not found');
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, cancelable: true
        }));
      })()
    `);

    // Check if the message was sent (input should be cleared or disabled)
    await new Promise((r) => setTimeout(r, 500));
    const sent = await bridge.eval(`
      (() => {
        const el = document.querySelector('[data-testid="chat-input"]');
        return el && (el.value === '' || el.disabled);
      })()
    `);

    if (sent) return;
    // If not sent, wait a bit and retry
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('Failed to send message after 3 attempts');
}

/**
 * Send a message and wait for the agent to finish responding.
 * Used by tests that need an active agent (e.g., slash command tests).
 */
export async function spawnAgentViaMessage(
  bridge: BridgeClient,
  opts?: { timeoutMs?: number },
): Promise<void> {
  await sendMessage(bridge, "hi");

  // Wait for agent to actually respond (assistant-message appears in DOM).
  // Previously we checked `!el.disabled`, but that returns immediately if
  // the input was never disabled (e.g., agent not yet spawned).
  await bridge.wait(
    {
      kind: "webview.eval",
      script: `!!document.querySelector('[data-testid="assistant-message"]')`,
    },
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 1_000 },
  );

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
