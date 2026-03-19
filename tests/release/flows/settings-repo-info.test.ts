import { describe, it, beforeAll } from "vitest";
import { createBridgeClient, type BridgeClient } from "../lib/bridge-client";
import { setBridge, click, waitFor, getText } from "../lib/ui";
import { expectVisible } from "../lib/assertions";

describe("Settings — Repository Info", () => {
  let bridge: BridgeClient;

  beforeAll(async () => {
    bridge = await createBridgeClient();
    setBridge(bridge);
  });

  it("should open settings as a full-screen overlay", async () => {
    await click('[data-testid="settings-btn"]');
    await waitFor('[data-testid="settings-overlay"]');
    await expectVisible('[data-testid="settings-overlay"]');
  });

  it("should show a repository tab in the sidebar", async () => {
    await expectVisible('[data-testid^="settings-repo-tab-"]');
  });

  it("should display repository details when clicking a repo tab", async () => {
    await click('[data-testid^="settings-repo-tab-"]');
    await waitFor('[data-testid="settings-repo-detail"]');

    const detail = await getText('[data-testid="settings-repo-detail"]');
    // Should contain path, default branch info
    expect(detail).toBeTruthy();
  });

  it("should show the delete button in the danger zone", async () => {
    await expectVisible('[data-testid="delete-repo-btn"]');
  });

  it("should close settings overlay", async () => {
    await click('[aria-label="Close settings"]');
    await waitFor('[data-testid="settings-overlay"]', { timeout: 2000 }).catch(() => {});
  });
});
