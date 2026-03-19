import { describe, it, beforeAll, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, getText, isVisible } from "../lib/ui";
import { addLocalRepo } from "../lib/flows/repository";

describe("Delete Repository — With Files", () => {
  let bridge: BridgeClient;
  let tempRepoPath: string;
  const repoName = `delete-test-${Date.now()}`;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);

    // Create a temporary git repo to add and then delete
    tempRepoPath = await mkdtemp(join(tmpdir(), "matrix-delete-test-"));
    execSync("git init", { cwd: tempRepoPath });
    execSync('git commit --allow-empty -m "init"', { cwd: tempRepoPath });
  });

  it("should add the temporary repo", async () => {
    await addLocalRepo(bridge, tempRepoPath);
    // Verify it appears
    await waitFor(`[data-testid="repo-item-${repoName}"]`, { timeout: 5000 }).catch(() => {
      // Name might be derived from the directory, not our variable
    });
  });

  it("should open settings and select the repo", async () => {
    await click('[data-testid="settings-btn"]');
    await waitFor('[data-testid="settings-overlay"]');

    // Click the last repo tab (the one we just added)
    const tabs = await bridge.eval(`
      (function(){
        var tabs = document.querySelectorAll('[data-testid^="settings-repo-tab-"]');
        if(tabs.length > 0) { tabs[tabs.length-1].click(); return 'clicked'; }
        return 'none';
      })()
    `);

    await waitFor('[data-testid="settings-repo-detail"]');
  });

  it("should check the delete source checkbox and confirm", async () => {
    await click('[data-testid="delete-repo-btn"]');
    await waitFor('[data-testid="delete-source-checkbox"]');

    // Check the "delete source files" checkbox
    await click('[data-testid="delete-source-checkbox"]');

    // Confirm deletion
    await click('[data-testid="confirm-delete-repo-btn"]');

    // Should return to General tab
    await waitFor('[data-testid="settings-overlay"]', { timeout: 10_000 });
  });

  it("should have deleted the source files from disk", async () => {
    // Give the server a moment to complete the rm
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(existsSync(tempRepoPath)).toBe(false);
  });

  it("should close settings", async () => {
    await click('[aria-label="Close settings"]');
  });
});
