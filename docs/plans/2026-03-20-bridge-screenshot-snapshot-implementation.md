# Bridge Screenshot & Snapshot — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore screenshot and DOM snapshot capabilities to the WebSocket bridge, supporting both macOS and iOS.

**Architecture:** Screenshot uses platform-native capture (macOS: `CGWindowListCreateImage` via Tauri command, iOS: `xcrun simctl` server-side exec). Snapshot uses a unified WebSocket path that collects DOM diagnostic info (testids, dialogs, focused element, body text) on both platforms identically.

**Tech Stack:** Rust (core-graphics, base64 crates), TypeScript (Hono server, bridge client), Tauri 2.x commands

**Design doc:** `docs/plans/2026-03-20-bridge-screenshot-snapshot-design.md`

---

### Task 1: Protocol types — add snapshot and screenshot message types

**Files:**
- Modify: `packages/server/src/bridge/protocol.ts`

**Step 1: Add new message types to protocol.ts**

Add `BridgeScreenshotMessage` and `BridgeSnapshotMessage` to the server message types, and include them in the `BridgeServerMessage` union.

```typescript
// Add after BridgeResetMessage (line 47):

export interface BridgeScreenshotMessage {
  type: "screenshot";
  requestId: string;
}

export interface BridgeSnapshotMessage {
  type: "snapshot";
  requestId: string;
}
```

Update the `BridgeServerMessage` union type (line 49-52) to include the new types:

```typescript
export type BridgeServerMessage =
  | BridgeEvalMessage
  | BridgeEventMessage
  | BridgeResetMessage
  | BridgeScreenshotMessage
  | BridgeSnapshotMessage;
```

**Step 2: Verify types compile**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/bridge/protocol.ts
git commit -m "feat(bridge): add screenshot and snapshot protocol message types"
```

---

### Task 2: Client-side — handle snapshot and screenshot WebSocket messages

**Files:**
- Modify: `packages/client/src/automation/bridge.ts`

**Step 1: Update the BridgeServerMessage type in bridge.ts**

The client-side `BridgeServerMessage` interface (line 189-196) needs `"snapshot"` and `"screenshot"` added to the `type` union:

```typescript
interface BridgeServerMessage {
  type: "eval" | "event" | "reset" | "snapshot" | "screenshot";
  requestId: string;
  script?: string;
  name?: string;
  payload?: unknown;
  scopes?: string[];
}
```

**Step 2: Add snapshot case to handleServerMessage**

Add after the `reset` case (line 310) in `handleServerMessage`:

```typescript
      case "snapshot": {
        try {
          const snapshot = {
            url: window.location.href,
            title: document.title,
            testids: Array.from(document.querySelectorAll("[data-testid]"))
              .map((el) => el.getAttribute("data-testid")),
            dialogs: Array.from(document.querySelectorAll("[role='dialog'], .fixed"))
              .map((el) => ({ tag: el.tagName, className: el.className })),
            focused: {
              tag: document.activeElement?.tagName ?? null,
              testid: document.activeElement?.getAttribute("data-testid") ?? null,
            },
            bodyText: document.body.innerText.substring(0, 1000),
            timestamp: Date.now(),
          };
          ws.send(JSON.stringify({ type: "response", requestId, result: snapshot }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: "response",
            requestId,
            error: err instanceof Error ? err.message : "snapshot failed",
          }));
        }
        break;
      }
```

**Step 3: Add screenshot case to handleServerMessage**

Add after the snapshot case. This calls the Tauri `screenshot` command (macOS only — iOS screenshots are handled server-side and never reach the client):

```typescript
      case "screenshot": {
        (async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const base64: string = await invoke("screenshot");
            ws.send(JSON.stringify({ type: "response", requestId, result: base64 }));
          } catch (err) {
            ws.send(JSON.stringify({
              type: "response",
              requestId,
              error: err instanceof Error ? err.message : "screenshot failed",
            }));
          }
        })();
        break;
      }
```

**Step 4: Verify client compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors (the `screenshot` Tauri command doesn't exist yet but `invoke` is stringly typed)

**Step 5: Commit**

```bash
git add packages/client/src/automation/bridge.ts
git commit -m "feat(bridge): handle snapshot and screenshot WebSocket messages in client"
```

---

### Task 3: Rust — add screenshot Tauri command using core-graphics

**Files:**
- Modify: `packages/client/src-tauri/Cargo.toml`
- Modify: `packages/client/src-tauri/src/lib.rs`

**Step 1: Add Rust dependencies to Cargo.toml**

Add to `[dependencies]` section after the existing deps:

```toml
core-graphics = "0.24"
core-foundation = "0.10"
base64 = "0.22"
```

**Step 2: Add screenshot command to lib.rs**

Add the `screenshot` function before the `run()` function. This captures the focused window using `CGWindowListCreateImage`. Key points:
- `#[cfg(target_os = "macos")]` — only compiles on macOS
- Gets the window list, finds our app window by owner PID
- Falls back to full-screen capture if window not found
- Returns base64-encoded PNG string

```rust
#[cfg(target_os = "macos")]
mod screenshot_impl {
    use base64::Engine;
    use core_foundation::base::TCFType;
    use core_graphics::display::{
        CGDisplay, CGWindowListCopyWindowInfo, kCGNullWindowID,
        kCGWindowListOptionOnScreenOnly,
    };
    use core_graphics::geometry::CGRect;
    use core_graphics::image::CGImage;
    use core_graphics::window::{
        kCGWindowNumber, kCGWindowOwnerPID,
    };
    use core_foundation::number::CFNumber;
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::array::CFArray;
    use core_foundation::string::CFString;
    use std::process;

    /// Capture a screenshot of the app's main window.
    /// Returns base64-encoded PNG data.
    pub fn capture() -> Result<String, String> {
        let our_pid = process::id() as i64;

        // Get on-screen window list
        let window_list = unsafe {
            CGWindowListCopyWindowInfo(
                kCGWindowListOptionOnScreenOnly,
                kCGNullWindowID,
            )
        };

        let windows: CFArray = unsafe { CFArray::wrap_under_get_rule(window_list as _) };

        // Find our app's window ID
        let mut target_window_id: Option<u32> = None;
        for i in 0..windows.len() {
            let dict_ref: CFDictionaryRef = unsafe {
                std::mem::transmute(windows.get(i))
            };
            let dict: core_foundation::dictionary::CFDictionary =
                unsafe { core_foundation::base::TCFType::wrap_under_get_rule(dict_ref) };

            let pid_key = CFString::new(unsafe { &*kCGWindowOwnerPID });
            if let Some(pid_val) = dict.find(pid_key.as_CFTypeRef()) {
                let pid_num: CFNumber =
                    unsafe { core_foundation::base::TCFType::wrap_under_get_rule(*pid_val as _) };
                if let Some(pid) = pid_num.to_i64() {
                    if pid == our_pid {
                        let wid_key = CFString::new(unsafe { &*kCGWindowNumber });
                        if let Some(wid_val) = dict.find(wid_key.as_CFTypeRef()) {
                            let wid_num: CFNumber =
                                unsafe { core_foundation::base::TCFType::wrap_under_get_rule(*wid_val as _) };
                            if let Some(wid) = wid_num.to_i32() {
                                target_window_id = Some(wid as u32);
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Capture the window image
        let image: CGImage = if let Some(wid) = target_window_id {
            CGDisplay::screenshot(
                CGRect::null(),
                kCGWindowListOptionOnScreenOnly,
                wid,
                Default::default(),
            ).ok_or_else(|| "CGDisplay::screenshot returned null".to_string())?
        } else {
            // Fallback: capture primary display
            let display = CGDisplay::main();
            display
                .image()
                .ok_or_else(|| "CGDisplay::image returned null".to_string())?
        };

        // Convert CGImage to PNG via system command (pipe raw RGBA through sips)
        // Alternative: use image crate, but to keep deps minimal, shell out to screencapture
        // as a reliable fallback
        capture_via_screencapture(target_window_id)
    }

    /// Fallback: use macOS `screencapture` CLI
    fn capture_via_screencapture(window_id: Option<u32>) -> Result<String, String> {
        let tmp_path = format!("/tmp/matrix-screenshot-{}.png", process::id());

        let status = if let Some(wid) = window_id {
            process::Command::new("screencapture")
                .args(["-l", &wid.to_string(), "-o", "-x", &tmp_path])
                .status()
        } else {
            process::Command::new("screencapture")
                .args(["-x", &tmp_path])
                .status()
        };

        match status {
            Ok(s) if s.success() => {}
            Ok(s) => return Err(format!("screencapture exited with code {:?}", s.code())),
            Err(e) => return Err(format!("screencapture failed: {e}")),
        }

        let png_bytes = std::fs::read(&tmp_path)
            .map_err(|e| format!("failed to read screenshot file: {e}"))?;
        let _ = std::fs::remove_file(&tmp_path);

        Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
    }
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn screenshot() -> Result<String, String> {
    screenshot_impl::capture()
}
```

Note: The `CGDisplay::screenshot` API requires specific parameters that differ across `core-graphics` crate versions. If the CGImage-to-PNG conversion is complex (no built-in PNG encoder in core-graphics), go straight to `capture_via_screencapture` which is reliable. The CGWindowListCopyWindowInfo call is still valuable — it gives us the window ID to pass to `screencapture -l`.

**Step 3: Register the screenshot command in the invoke handler**

In `lib.rs` `run()`, add `screenshot` to the macOS invoke handler (line 59-66):

```rust
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        updater::check_update,
        updater::download_update,
        updater::install_update,
        get_sidecar_port,
        mock_file_dialog,
        consume_mock_file_dialog,
        screenshot,
    ]);
```

Also add to the other desktop handler (line 68-73):

```rust
    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_sidecar_port,
        mock_file_dialog,
        consume_mock_file_dialog,
        // screenshot not available on non-macOS desktop
    ]);
```

**Step 4: Verify Rust compiles**

Run: `cd packages/client/src-tauri && cargo check`
Expected: Compiles successfully (may have warnings about unused imports if CGImage path is not used)

If `core-graphics` API doesn't work as expected (version mismatch, missing methods), simplify the `capture()` function to go directly to `capture_via_screencapture`:

```rust
pub fn capture() -> Result<String, String> {
    let our_pid = process::id() as i64;

    // Get window ID via CGWindowListCopyWindowInfo
    let window_id = find_window_id(our_pid);

    // Use screencapture CLI (most reliable on macOS)
    capture_via_screencapture(window_id)
}
```

**Step 5: Commit**

```bash
git add packages/client/src-tauri/Cargo.toml packages/client/src-tauri/src/lib.rs
git commit -m "feat(bridge): add macOS screenshot Tauri command via core-graphics + screencapture"
```

---

### Task 4: Server — add /bridge/snapshot endpoint

**Files:**
- Modify: `packages/server/src/bridge/index.ts`

**Step 1: Add the /bridge/snapshot endpoint**

Add after the `/bridge/wait` endpoint (before line 190 closing brace of `setupBridge`):

```typescript
  app.post("/bridge/snapshot", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string }>();
    const requestId = clientRegistry.generateRequestId();

    try {
      const result = await clientRegistry.sendRequest(body.clientId, {
        type: "snapshot",
        requestId,
      });
      return c.json({ ok: true, result, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "snapshot failed";
      return c.json({ ok: false, result: null, error: message }, 502);
    }
  });
```

**Step 2: Verify server compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/bridge/index.ts
git commit -m "feat(bridge): add /bridge/snapshot endpoint"
```

---

### Task 5: Server — add /bridge/screenshot endpoint with platform routing

**Files:**
- Modify: `packages/server/src/bridge/index.ts`

**Step 1: Add the /bridge/screenshot endpoint**

This endpoint routes based on the client's platform. For iOS, it runs `xcrun simctl` directly on the host. For macOS, it sends a WebSocket message to the client.

Add after the `/bridge/snapshot` endpoint:

```typescript
  app.post("/bridge/screenshot", async (c: Context) => {
    const body = await c.req.json<{ clientId?: string }>();
    const client = clientRegistry.getClient(body.clientId);

    if (!client) {
      const msg = body.clientId
        ? `Client "${body.clientId}" not found`
        : "No clients connected";
      return c.json({ ok: false, error: msg }, 502);
    }

    try {
      let base64Data: string;

      if (client.info.platform === "ios") {
        // iOS Simulator: capture via xcrun simctl on host
        const { execSync } = await import("node:child_process");
        const { readFileSync, unlinkSync } = await import("node:fs");
        const { randomUUID } = await import("node:crypto");
        const tmpFile = `/tmp/matrix-screenshot-${randomUUID()}.png`;
        execSync(`xcrun simctl io booted screenshot "${tmpFile}"`, {
          timeout: 10_000,
        });
        base64Data = readFileSync(tmpFile).toString("base64");
        unlinkSync(tmpFile);
      } else {
        // macOS: relay through WebSocket to Tauri command
        const requestId = clientRegistry.generateRequestId();
        const result = await clientRegistry.sendRequest(body.clientId, {
          type: "screenshot",
          requestId,
        });
        base64Data = result as string;
      }

      // Return raw PNG binary
      const pngBuffer = Buffer.from(base64Data, "base64");
      return new Response(pngBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(pngBuffer.length),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "screenshot failed";
      return c.json({ ok: false, error: message }, 502);
    }
  });
```

**Step 2: Verify server compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/bridge/index.ts
git commit -m "feat(bridge): add /bridge/screenshot endpoint with iOS/macOS platform routing"
```

---

### Task 6: Update automation bridge skill doc

**Files:**
- Modify: `.claude/skills/automation-bridge/SKILL.md`

**Step 1: Add screenshot and snapshot endpoint docs to SKILL.md**

Find the `### POST /bridge/wait` section and add the following sections after it:

```markdown
### POST /bridge/snapshot

Capture a DOM diagnostic snapshot from the webview. Returns testids, dialogs, focused element, and visible text.

\```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$B/bridge/snapshot"
\```

Response:
\```json
{
  "ok": true,
  "result": {
    "url": "http://127.0.0.1:19880/",
    "title": "Matrix",
    "testids": ["add-repo-btn", "repo-item-matrix", "chat-input"],
    "dialogs": [{ "tag": "DIV", "className": "fixed inset-0 ..." }],
    "focused": { "tag": "TEXTAREA", "testid": "chat-input" },
    "bodyText": "Matrix — first 1000 chars of visible text...",
    "timestamp": 1742486400000
  }
}
\```

### POST /bridge/screenshot

Capture a screenshot of the application window. Returns raw PNG binary.

- **macOS**: Captures the app window via `CGWindowListCreateImage` + `screencapture`
- **iOS Simulator**: Captures via `xcrun simctl io booted screenshot`

\```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$B/bridge/screenshot" \
  --output screenshot.png
\```

To target a specific client (when both macOS and iOS are connected):

\```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"ios-main"}' \
  "$B/bridge/screenshot" \
  --output ios-screenshot.png
\```
```

**Step 2: Commit**

```bash
git add .claude/skills/automation-bridge/SKILL.md
git commit -m "docs: add screenshot and snapshot endpoints to automation bridge skill"
```

---

### Task 7: Manual verification

**Step 1: Start the dev server**

Run: `pnpm dev:mac`

**Step 2: Verify bridge health**

```bash
set -a; source .env.local; set +a
export B="http://127.0.0.1:$MATRIX_PORT"
export T="$MATRIX_TOKEN"
curl --noproxy "*" -s -H "Authorization: Bearer $T" "$B/bridge/health" | python3 -m json.tool
```

Expected: `clientCount > 0`

**Step 3: Test snapshot endpoint**

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$B/bridge/snapshot" | python3 -m json.tool
```

Expected: JSON with `ok: true`, `result` containing `url`, `testids`, `dialogs`, `focused`, `bodyText`, `timestamp`

**Step 4: Test screenshot endpoint**

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$B/bridge/screenshot" \
  --output /tmp/matrix-test-screenshot.png

file /tmp/matrix-test-screenshot.png
```

Expected: `PNG image data, ...` (valid PNG file)

**Step 5: View screenshot**

```bash
open /tmp/matrix-test-screenshot.png
```

Expected: Screenshot of the Matrix app window

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address verification issues for screenshot/snapshot"
```
