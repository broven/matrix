import { describe, it, beforeAll, expect } from "vitest";
import { existsSync } from "node:fs";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, getText, isVisible, getValue } from "../lib/ui";

describe("Delete Repository — Keep Files", () => {
  let bridge: BridgeClient;
  let repoPath: string;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open settings and select a repository", async () => {
    await click('[data-testid="settings-btn"]');
    await waitFor('[data-testid="settings-overlay"]');
    await click('[data-testid^="settings-repo-tab-"]');
    await waitFor('[data-testid="settings-repo-detail"]');

    // Capture the repo path for later verification
    const detail = await getText('[data-testid="settings-repo-detail"]');
    // Extract path from the detail text (it appears after "Path")
    const pathMatch = detail.match(/Path\s*(.+?)(?:Remote URL|$)/s);
    if (pathMatch) {
      repoPath = pathMatch[1].trim();
    }
  });

  it("should click delete and see the checkbox unchecked by default", async () => {
    await click('[data-testid="delete-repo-btn"]');
    await waitFor('[data-testid="delete-source-checkbox"]');

    const checked = await bridge.eval(`
      (function(){
        var cb = document.querySelector('[data-testid="delete-source-checkbox"]');
        return cb ? cb.checked : null;
      })()
    `);
    expect(checked.result).toBe(false);
  });

  it("should delete the repo without deleting source files", async () => {
    await click('[data-testid="confirm-delete-repo-btn"]');

    // Should return to General tab (settings still open)
    await waitFor('[data-testid="settings-overlay"]', { timeout: 5000 });

    // Source files should still exist
    if (repoPath) {
      expect(existsSync(repoPath)).toBe(true);
    }
  });

  it("should close settings", async () => {
    await click('[aria-label="Close settings"]');
  });
});
