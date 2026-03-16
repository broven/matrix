import { test, expect, type Page } from "@playwright/test";

/**
 * Set up Tauri IPC mocks via addInitScript so they exist before any app code runs.
 *
 * This replicates what `@tauri-apps/api/mocks` `mockIPC` + `mockWindows` do:
 *   - window.__TAURI_INTERNALS__  (invoke, transformCallback, runCallback, etc.)
 *   - window.__TAURI_EVENT_PLUGIN_INTERNALS__  (unregisterListener)
 *
 * The `ipcBehaviour` object on window lets the test control per-command responses
 * from outside the page context via page.evaluate().
 */
function addTauriMocks(
  page: Page,
  opts: {
    checkUpdate?: {
      has_update: boolean;
      version?: string;
      download_url?: string;
      release_notes?: string;
    };
  } = {}
) {
  const checkUpdate = opts.checkUpdate ?? {
    has_update: true,
    version: "0.2.0",
    download_url: "https://github.com/example/releases/download/v0.2.0/app.dmg",
    release_notes: "Bug fixes and improvements",
  };

  return page.addInitScript(
    (checkUpdateResponse) => {
      // ---- callback registry (mirrors mocks.js) ----
      const callbacks = new Map<number, (data: unknown) => void>();

      function registerCallback(
        callback: ((data: unknown) => void) | undefined,
        once = false
      ): number {
        const id = crypto.getRandomValues(new Uint32Array(1))[0];
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          callback?.(data);
        });
        return id;
      }

      function unregisterCallback(id: number) {
        callbacks.delete(id);
      }

      function runCallback(id: number, data: unknown) {
        const cb = callbacks.get(id);
        if (cb) cb(data);
      }

      // ---- event system (mirrors mockIPC shouldMockEvents) ----
      const eventListeners = new Map<string, number[]>();

      function handleListen(args: { event: string; handler: number }) {
        if (!eventListeners.has(args.event)) {
          eventListeners.set(args.event, []);
        }
        eventListeners.get(args.event)!.push(args.handler);
        return args.handler; // eventId
      }

      function handleEmit(args: { event: string; payload?: unknown }) {
        const ids = eventListeners.get(args.event) || [];
        for (const id of ids) {
          runCallback(id, { event: args.event, payload: args.payload });
        }
        return null;
      }

      function handleUnlisten(args: { event: string; eventId: number }) {
        const ids = eventListeners.get(args.event);
        if (ids) {
          const idx = ids.indexOf(args.eventId);
          if (idx !== -1) ids.splice(idx, 1);
        }
      }

      // ---- IPC recording ----
      const invokedCommands: Array<{ cmd: string; args: unknown }> = [];

      // ---- invoke handler ----
      async function invoke(
        cmd: string,
        args: Record<string, unknown> = {},
        _options?: unknown
      ) {
        // Handle event plugin commands
        if (cmd === "plugin:event|listen") return handleListen(args as never);
        if (cmd === "plugin:event|emit") return handleEmit(args as never);
        if (cmd === "plugin:event|unlisten") return handleUnlisten(args as never);

        invokedCommands.push({ cmd, args });

        // App commands
        switch (cmd) {
          case "check_update":
            return checkUpdateResponse;
          case "download_update":
            return "/tmp/update-0.2.0.dmg";
          case "install_update":
            return null;
          default:
            return null;
        }
      }

      // ---- wire up __TAURI_INTERNALS__ ----
      (window as any).__TAURI_INTERNALS__ = {
        invoke,
        transformCallback: registerCallback,
        unregisterCallback,
        runCallback,
        callbacks,
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { windowLabel: "main", label: "main" },
        },
      };

      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(event: string, id: number) {
          unregisterCallback(id);
        },
      };

      // Expose helpers the test can call via page.evaluate()
      (window as any).__TEST_TAURI__ = {
        invokedCommands,
        emitEvent(event: string, payload: unknown) {
          handleEmit({ event, payload });
        },
      };
    },
    checkUpdate
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Auto-update", () => {
  test("shows update toast when a new version is available", async ({
    page,
  }) => {
    await addTauriMocks(page);
    await page.goto("/");

    // The toast should appear with version info
    await expect(page.getByText("v0.2.0 available")).toBeVisible();
    await expect(
      page.getByText("Bug fixes and improvements")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Later" })).toBeVisible();
  });

  test("does not show toast when no update is available", async ({ page }) => {
    await addTauriMocks(page, {
      checkUpdate: {
        has_update: false,
        version: "",
        download_url: "",
        release_notes: "",
      },
    });
    await page.goto("/");

    // Give the app time to settle — toast should NOT appear
    await page.waitForTimeout(1500);
    await expect(page.getByText("available")).not.toBeVisible();
  });

  test("dismiss hides the toast", async ({ page }) => {
    await addTauriMocks(page);
    await page.goto("/");

    await expect(page.getByText("v0.2.0 available")).toBeVisible();

    // Click "Later"
    await page.getByRole("button", { name: "Later" }).click();

    await expect(page.getByText("v0.2.0 available")).not.toBeVisible();
  });

  test("download flow: Update -> downloading -> ready -> Install Now", async ({
    page,
  }) => {
    await addTauriMocks(page);
    await page.goto("/");

    // 1. Toast shows "Update" button
    await expect(page.getByRole("button", { name: "Update" })).toBeVisible();

    // 2. Click Update — triggers downloadUpdate which invokes download_update
    await page.getByRole("button", { name: "Update" }).click();

    // 3. The hook sets state to "downloading" then to "ready" once download_update resolves.
    //    Since our mock returns immediately, it should go straight to "ready".
    await expect(page.getByText("Update ready to install")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Install Now" })
    ).toBeVisible();
  });

  test("install flow: Install Now invokes install_update", async ({
    page,
  }) => {
    await addTauriMocks(page);
    await page.goto("/");

    // Get to "ready" state
    await page.getByRole("button", { name: "Update" }).click();
    await expect(
      page.getByRole("button", { name: "Install Now" })
    ).toBeVisible();

    // Click Install Now
    await page.getByRole("button", { name: "Install Now" }).click();

    // Verify install_update was invoked
    const invoked = await page.evaluate(() => {
      return (window as any).__TEST_TAURI__.invokedCommands;
    });

    const installCalls = invoked.filter(
      (c: { cmd: string }) => c.cmd === "install_update"
    );
    expect(installCalls.length).toBe(1);
    expect(installCalls[0].args).toHaveProperty("dmgPath");
  });

  test("download progress events update the progress bar", async ({
    page,
  }) => {
    await addTauriMocks(page);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Update" })).toBeVisible();

    // We need to slow down the download so we can observe the downloading state.
    // Override the download_update mock to hang until we resolve it.
    await page.evaluate(() => {
      (window as any).__downloadResolve = null;
      const orig = (window as any).__TAURI_INTERNALS__.invoke;
      (window as any).__TAURI_INTERNALS__.invoke = async (
        cmd: string,
        args: unknown,
        options: unknown
      ) => {
        if (cmd === "download_update") {
          return new Promise((resolve) => {
            (window as any).__downloadResolve = resolve;
          });
        }
        return orig(cmd, args, options);
      };
    });

    // Click Update
    await page.getByRole("button", { name: "Update" }).click();

    // Should now be in "downloading" state
    await expect(page.getByText("Downloading update...")).toBeVisible();
    await expect(page.getByText("0%")).toBeVisible();

    // Emit progress events
    await page.evaluate(() => {
      (window as any).__TEST_TAURI__.emitEvent("update-download-progress", {
        downloaded: 50,
        total: 100,
      });
    });
    await expect(page.getByText("50%")).toBeVisible();

    await page.evaluate(() => {
      (window as any).__TEST_TAURI__.emitEvent("update-download-progress", {
        downloaded: 100,
        total: 100,
      });
    });
    await expect(page.getByText("100%")).toBeVisible();

    // Resolve the download
    await page.evaluate(() => {
      (window as any).__downloadResolve("/tmp/update-0.2.0.dmg");
    });

    // Should transition to "ready"
    await expect(page.getByText("Update ready to install")).toBeVisible();
  });
});
