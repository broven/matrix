# Bridge Screenshot & Snapshot — Design

## Summary

Restore screenshot and DOM snapshot capabilities that were lost in the PR #62 bridge migration. Implement for both macOS and iOS.

## New Endpoints

```
POST /bridge/screenshot  → Content-Type: image/png (raw binary)
POST /bridge/snapshot    → JSON { ok, result: { url, testids, dialogs, focused, bodyText, timestamp } }
```

## Screenshot — Platform-Native, Server-Side Routing

The server inspects the target client's `platform` field and routes accordingly:

### macOS Path

```
POST /bridge/screenshot { clientId? }
  → Server sends WS {type:"screenshot", requestId} to macos client
  → Client JS: invoke("screenshot") via Tauri API
  → Rust: CGWindowListCreateImage → PNG bytes → base64 string
  → Client sends base64 back via WS response
  → Server decodes base64 → returns raw image/png binary
```

**Rust implementation**: New `#[tauri::command] fn screenshot()` in `src-tauri/src/lib.rs`.
Uses `core-graphics` crate for `CGWindowListCreateImage` to capture the app window.
If CGWindowListCreateImage proves problematic (window ID issues), fall back to `screencapture -l <windowId>` CLI.

**New Cargo.toml dependencies**: `core-graphics`, `base64`.

### iOS Simulator Path

```
POST /bridge/screenshot { clientId? }
  → Server detects platform === "ios"
  → Server exec: xcrun simctl io booted screenshot /tmp/matrix-screenshot-{id}.png
  → Read file → return raw image/png binary
  → Clean up temp file
```

Does not traverse WebSocket. Server executes directly on host.

## Snapshot — Unified, No Platform Difference

Both macOS and iOS use the same WebSocket path:

```
POST /bridge/snapshot { clientId? }
  → Server sends WS {type:"snapshot", requestId} to client
  → Client JS executes fixed diagnostic logic
  → Returns JSON with: url, title, testids, dialogs, focused, bodyText, timestamp
```

### Snapshot Response Shape

```json
{
  "url": "http://127.0.0.1:19880/",
  "title": "Matrix",
  "testids": ["add-repo-btn", "repo-item-matrix", "chat-input"],
  "dialogs": [{ "tag": "DIV", "className": "fixed inset-0 ..." }],
  "focused": { "tag": "TEXTAREA", "testid": "chat-input" },
  "bodyText": "Matrix — first 1000 chars of visible text...",
  "timestamp": 1742486400000
}
```

## Protocol Extensions

### New Server → Client messages

```typescript
interface BridgeScreenshotMessage {
  type: "screenshot";
  requestId: string;
}

interface BridgeSnapshotMessage {
  type: "snapshot";
  requestId: string;
}
```

## Files Changed

| File | Change |
|------|--------|
| `packages/client/src-tauri/Cargo.toml` | Add `core-graphics`, `base64` deps |
| `packages/client/src-tauri/src/lib.rs` | New `#[tauri::command] fn screenshot()` |
| `packages/server/src/bridge/protocol.ts` | Add `BridgeScreenshotMessage`, `BridgeSnapshotMessage` |
| `packages/server/src/bridge/index.ts` | Add `POST /bridge/screenshot`, `POST /bridge/snapshot` |
| `packages/client/src/automation/bridge.ts` | Handle `screenshot` and `snapshot` WS messages |
| `.claude/skills/automation-bridge/SKILL.md` | Document new endpoints |

## Design Decisions

- **Screenshot returns raw `image/png`** (not base64 JSON) — consistent with the pre-migration API
- **macOS uses `CGWindowListCreateImage`** (fallback: `screencapture` CLI) — native window capture
- **iOS uses `xcrun simctl io booted screenshot`** — server-side exec, no WebSocket roundtrip
- **Snapshot is lightweight** — testids, dialogs, focused element, body text; no full HTML dump
- **base64 only used internally** in WebSocket transport for macOS screenshot relay
