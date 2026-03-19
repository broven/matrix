import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DownloadProgress } from "@/hooks/useAutoUpdate";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
  isMacOS: () => true,
  isMobilePlatform: () => false,
  hasLocalServer: () => true,
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Capture the listener registered via `listen` so tests can emit events.
let capturedProgressListener: ((event: { payload: DownloadProgress }) => void) | null = null;
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, handler: (event: { payload: DownloadProgress }) => void) => {
    capturedProgressListener = handler;
    return Promise.resolve(mockUnlisten);
  }),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get() { return undefined; }
    async set() {}
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// ── Imports (mocks are hoisted by vitest, so these see mocked modules) ───────

import { UpdateProvider, useAutoUpdate } from "@/hooks/useAutoUpdate";
import { UpdateToast } from "@/components/UpdateToast";

// ── Helpers ──────────────────────────────────────────────────────────────────

const UPDATE_RESULT = {
  has_update: true,
  version: "0.2.0",
  download_url: "https://github.com/example/releases/download/v0.2.0/app.dmg",
  release_notes: "Bug fixes",
};

const NO_UPDATE_RESULT = {
  has_update: false,
  version: "",
  download_url: "",
  release_notes: "",
};

/**
 * A test harness that renders UpdateProvider + UpdateToast wired via context,
 * and exposes a manual `checkForUpdate` trigger button.
 */
function TestHarness() {
  const ctx = useAutoUpdate();
  return (
    <>
      <UpdateToast
        state={ctx.state}
        updateInfo={ctx.updateInfo}
        progress={ctx.progress}
        error={ctx.error}
        onDownload={ctx.downloadUpdate}
        onInstall={ctx.installUpdate}
        onDismiss={ctx.dismiss}
      />
      <button data-testid="manual-check" onClick={ctx.checkForUpdate}>
        Manual Check
      </button>
      <span data-testid="state">{ctx.state}</span>
      {ctx.error && <span data-testid="error">{ctx.error}</span>}
    </>
  );
}

function renderApp() {
  return render(
    <UpdateProvider>
      <TestHarness />
    </UpdateProvider>,
  );
}

/** Render the app and trigger a manual check to get to "available" state. */
async function renderAndCheck(user: ReturnType<typeof userEvent.setup>) {
  renderApp();
  await user.click(screen.getByTestId("manual-check"));
  await waitFor(() => {
    expect(screen.getByText(/v0\.2\.0 available/)).toBeInTheDocument();
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("useAutoUpdate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProgressListener = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ─── 1. Full update flow ───────────────────────────────────────────────────

  it("full flow: check -> available -> download -> ready -> install", async () => {
    const user = userEvent.setup();

    let downloadResolve: ((val: string) => void) | null = null;

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.resolve(UPDATE_RESULT);
      if (cmd === "download_update") {
        return new Promise<string>((resolve) => {
          downloadResolve = resolve;
        });
      }
      if (cmd === "install_update") return Promise.resolve();
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    await renderAndCheck(user);

    // Click "Update" to start download
    await user.click(screen.getByText("Update"));

    // While downloading, simulate progress events
    await waitFor(() => {
      expect(screen.getByText("Downloading update...")).toBeInTheDocument();
    });

    // Emit progress events via the captured listener
    await act(async () => {
      capturedProgressListener?.({ payload: { downloaded: 50, total: 100 } });
    });
    await waitFor(() => {
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    // Complete the download
    await act(async () => {
      downloadResolve?.("/path/to/update.dmg");
    });

    // state becomes "ready"
    await waitFor(() => {
      expect(screen.getByText("Install Now")).toBeInTheDocument();
    });

    // Click "Install Now"
    await user.click(screen.getByText("Install Now"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("install_update", {
        dmgPath: "/path/to/update.dmg",
      });
    });
  });

  // ─── 2. Dismiss available update — suppresses until next cycle ──────────

  it("dismiss available update suppresses re-show for same version", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.resolve(UPDATE_RESULT);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    await renderAndCheck(user);

    // Click "Later" to dismiss
    await user.click(screen.getByText("Later"));

    // Toast should disappear
    await waitFor(() => {
      expect(screen.queryByText(/v0\.2\.0 available/)).not.toBeInTheDocument();
    });

    // Manually trigger another check — same version should be suppressed
    await user.click(screen.getByTestId("manual-check"));

    // Give it time to process; state should return to idle, not available
    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("idle");
    });

    // Toast should still not be visible
    expect(screen.queryByText(/v0\.2\.0 available/)).not.toBeInTheDocument();
  });

  // ─── 3. Dismiss ready update — re-shows install prompt on next check ───

  it("dismiss ready update keeps dmg and re-check shows install prompt", async () => {
    const user = userEvent.setup();

    let downloadResolve: ((val: string) => void) | null = null;

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.resolve(UPDATE_RESULT);
      if (cmd === "download_update") {
        return new Promise<string>((resolve) => {
          downloadResolve = resolve;
        });
      }
      if (cmd === "install_update") return Promise.resolve();
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    await renderAndCheck(user);

    // Click Update to start download
    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Downloading update...")).toBeInTheDocument();
    });

    // Complete the download
    await act(async () => {
      downloadResolve?.("/path/to/update.dmg");
    });

    // Should be "ready"
    await waitFor(() => {
      expect(screen.getByText("Install Now")).toBeInTheDocument();
    });

    // Dismiss the ready toast
    await user.click(screen.getByText("Later"));

    await waitFor(() => {
      expect(screen.queryByText("Install Now")).not.toBeInTheDocument();
    });

    // State should be idle
    expect(screen.getByTestId("state").textContent).toBe("idle");

    // Now manually re-check. The hook code will call check_update again,
    // and since the version was NOT added to dismissedVersion (only "available"
    // dismissals do that), it should transition to "available" again.
    await user.click(screen.getByTestId("manual-check"));

    await waitFor(() => {
      expect(screen.getByText(/v0\.2\.0 available/)).toBeInTheDocument();
    });
  });

  // ─── 4. No update available — toast doesn't show ──────────────────────

  it("no update available shows no toast", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.resolve(NO_UPDATE_RESULT);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    renderApp();

    await user.click(screen.getByTestId("manual-check"));

    // Wait for check to complete
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_update", { channel: "stable" });
    });

    // State should be idle (no update available)
    expect(screen.getByTestId("state").textContent).toBe("idle");

    // No toast should be visible
    expect(screen.queryByText(/available/)).not.toBeInTheDocument();
    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    expect(screen.queryByText("Install Now")).not.toBeInTheDocument();
  });

  // ─── 5. Check doesn't interrupt download ──────────────────────────────

  it("checkForUpdate does not interrupt an in-progress download", async () => {
    const user = userEvent.setup();

    let downloadResolve: ((val: string) => void) | null = null;

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.resolve(UPDATE_RESULT);
      if (cmd === "download_update") {
        return new Promise<string>((resolve) => {
          downloadResolve = resolve;
        });
      }
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    await renderAndCheck(user);

    // Start download
    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("downloading");
    });

    // Manually trigger checkForUpdate while downloading
    await user.click(screen.getByTestId("manual-check"));

    // State should still be "downloading" — check was a no-op
    expect(screen.getByTestId("state").textContent).toBe("downloading");
    expect(screen.getByText("Downloading update...")).toBeInTheDocument();

    // Clean up: resolve the download to avoid hanging promise
    await act(async () => {
      downloadResolve?.("/path/to/update.dmg");
    });

    await waitFor(() => {
      expect(screen.getByTestId("state").textContent).toBe("ready");
    });
  });

  // ─── 6. Network error during check ────────────────────────────────────

  it("network error during check sets error and shows no toast", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "check_update") return Promise.reject(new Error("Network error"));
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    renderApp();

    await user.click(screen.getByTestId("manual-check"));

    // Wait for error state to be set
    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Network error");
    });

    // State should be idle (error resets to idle)
    expect(screen.getByTestId("state").textContent).toBe("idle");

    // No update toast should be visible
    expect(screen.queryByText(/available/)).not.toBeInTheDocument();
    expect(screen.queryByText("Update")).not.toBeInTheDocument();
  });
});
