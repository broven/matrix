import type { BridgeClient } from "../bridge-client";
import { click, type as typeText, waitFor, waitForGone, isVisible } from "../ui";

/**
 * Add a local repository via the Open Project dialog.
 * Requires the mock-file-dialog endpoint or manual path entry.
 */
export async function addLocalRepo(
  bridge: BridgeClient,
  repoPath: string,
  opts?: { name?: string },
): Promise<void> {
  // Pre-seed the mock file dialog so the native picker returns this path
  await bridge.mockFileDialog(repoPath);

  // Open the Add Repository menu
  await click('[data-testid="add-repo-btn"]');
  await waitFor('[data-testid="open-local-option"]');

  // Click "Open Project"
  await click('[data-testid="open-local-option"]');
  await waitFor('[data-testid="path-input"]');

  // Type the project path
  await typeText('[data-testid="path-input"]', repoPath);

  // Click confirm
  await click('[data-testid="confirm-btn"]');

  // Wait for the repo to appear in the sidebar
  const expectedName = opts?.name ?? repoPath.split("/").pop() ?? "";
  await waitFor(`[data-testid="repo-item-${expectedName}"]`, { timeout: 10_000 });
}

/**
 * Clone a repository from a URL via the Clone dialog.
 */
export async function cloneFromUrl(
  bridge: BridgeClient,
  url: string,
): Promise<void> {
  // Open the Add Repository menu
  await click('[data-testid="add-repo-btn"]');
  await waitFor('[data-testid="clone-url-option"]');

  // Click "Clone from URL"
  await click('[data-testid="clone-url-option"]');
  await waitFor('[data-testid="clone-url-input"]');

  // Type the URL
  await typeText('[data-testid="clone-url-input"]', url);

  // Click clone
  await click('[data-testid="clone-submit-btn"]');
}

/**
 * Delete a repository/session via context menu.
 */
export async function deleteSession(
  bridge: BridgeClient,
): Promise<void> {
  await click('[data-testid="delete-repo-option"]');
  await waitFor('[data-testid="confirm-delete-btn"]');
  await click('[data-testid="confirm-delete-btn"]');
}

/**
 * Check if a repo item exists in the sidebar.
 */
export async function repoExists(name: string): Promise<boolean> {
  return isVisible(`[data-testid="repo-item-${name}"]`);
}
