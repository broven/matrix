# Bridge Server-Client Architecture

**Date:** 2026-03-20
**Status:** Approved

## Goal

Refactor the automation bridge from an embedded HTTP server inside the app (Rust) to a server-client architecture where:
- Bridge Server runs inside `matrix-server` (existing process, existing port)
- App webviews connect as WebSocket clients on startup
- Test runners and AI agents interact via HTTP API on the same server

This eliminates iOS port-binding issues, supports multiple simultaneous clients (macOS + iOS + future devices), and provides a foundation for AI-driven client control beyond testing.

## Architecture

**Current (to be removed):**
```
Test Runner → HTTP → [Rust Bridge Server in App] → Tauri Event → JS Bridge
```

**New:**
```
Test Runner / AI Agent → HTTP → [Bridge Server in matrix-server]
                                        ↕ WebSocket
                         [JS Bridge Client in App WebView] (multiple clients)
```

## Components

### 1. Bridge Server (in `packages/server`)

**Location:** `packages/server/src/bridge/`

**WebSocket endpoint:** `GET /bridge` — upgrades to WebSocket, authenticated via `?token=xxx` or `Authorization: Bearer xxx` (same as existing API).

**HTTP API (for test runners / AI agents):**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/bridge/clients` | GET | List all connected clients |
| `/bridge/eval` | POST | Execute JS in a client's webview |
| `/bridge/event` | POST | Dispatch event to a client |
| `/bridge/health` | GET | Bridge status + connected client list |
| `/bridge/reset` | POST | Reset test state on a client |
| `/bridge/wait` | POST | Wait for a condition on a client |

**Request body with client targeting:**
```json
{ "clientId": "ios-main", "script": "document.title" }
```

- `clientId` omitted + 1 client → uses that client
- `clientId` omitted + multiple clients → uses the first registered client
- `clientId` specified → targets that specific client

### 2. Client Registration

WebSocket connect → client sends register message:
```json
{ "type": "register", "platform": "ios", "label": "main", "userAgent": "..." }
```

Server generates `clientId = "{platform}-{label}"` (e.g. `macos-main`, `ios-main`).

**Multi-client support:**
- Multiple iOS devices can connect simultaneously
- Multiple macOS instances from different worktrees
- Server maintains `Map<clientId, WebSocket>` with metadata
- Duplicate `clientId` → suffix with counter (`ios-main-2`)
- Client disconnects → removed from map, reconnects auto-re-register

### 3. JS Bridge Client (in `packages/client`)

**Location:** `packages/client/src/automation/bridge.ts` (refactor existing)

**Behavior:**
- On app startup (dev/debug builds only), connects to bridge server via WebSocket
- Connection URL derived from matrix-server URL: `ws://127.0.0.1:${MATRIX_PORT}/bridge?token=${MATRIX_TOKEN}`
- Sends register message with platform + window label
- Listens for commands (eval, event, reset) and responds with results
- Auto-reconnects on disconnect (exponential backoff)
- Installs `window.__MATRIX_AUTOMATION__` as before (for backward compat during migration)

**How it gets the server URL:**
- Desktop: from `get_sidecar_port` Tauri command (existing)
- iOS: from `MATRIX_DEV_SERVER_URL` env var baked at build time, or from the auto-connect URL params

### 4. Rust Changes

**Remove entirely:**
- `packages/client/src-tauri/src/automation/` — all files
- `AutomationServerState`, `initialize_automation_runtime`, `initialize_mobile_automation` from `lib.rs`
- All `#[cfg(any(test, debug_assertions))]` automation-related code

**Keep as Tauri command:**
- `mock_file_dialog` — expose as `#[tauri::command]`, called by JS bridge via `invoke()`

### 5. Protocol (WebSocket messages)

**Client → Server:**
```json
{ "type": "register", "platform": "ios", "label": "main" }
{ "type": "response", "requestId": "abc123", "result": {...}, "error": null }
{ "type": "heartbeat" }
```

**Server → Client:**
```json
{ "type": "eval", "requestId": "abc123", "script": "document.title" }
{ "type": "event", "requestId": "abc123", "name": "click", "payload": {...} }
{ "type": "reset", "requestId": "abc123", "scopes": ["webStorage"] }
```

**Server → Test Runner (HTTP response):**
Blocks until client responds via WebSocket, with configurable timeout.

## Authentication

- Bridge WebSocket and HTTP endpoints share `MATRIX_TOKEN` auth with existing server APIs
- No separate bridge token needed
- Per-worktree isolation via unique `MATRIX_PORT` (already assigned in `wt.toml`)

## Port Allocation Impact

**Ports removed from `.env.local`:**
- `MATRIX_AUTOMATION_PORT` — no longer needed (bridge is on `MATRIX_PORT`)
- `MATRIX_AUTOMATION_PORT_IOS` — no longer needed
- `MATRIX_AUTOMATION_TOKEN` — no longer needed (uses `MATRIX_TOKEN`)

**wt.toml** goes back to 4 ports (base+0 to base+3).

## Migration Path

1. Implement bridge server in `packages/server/src/bridge/`
2. Refactor JS bridge client to WebSocket
3. Update test runner (`bridge-client.ts`) to use new HTTP endpoints
4. Remove Rust automation module
5. Update wt.toml to remove automation ports
6. Clean up env vars

## File Changes

| Action | File |
|--------|------|
| **Add** | `packages/server/src/bridge/index.ts` — WebSocket server + HTTP routes |
| **Add** | `packages/server/src/bridge/client-registry.ts` — multi-client management |
| **Add** | `packages/server/src/bridge/protocol.ts` — message types |
| **Refactor** | `packages/client/src/automation/bridge.ts` — HTTP server → WS client |
| **Remove** | `packages/client/src-tauri/src/automation/**` — entire Rust module |
| **Modify** | `packages/client/src-tauri/src/lib.rs` — remove automation init |
| **Modify** | `tests/e2e/mac/lib/bridge-client.ts` — point to server HTTP endpoints |
| **Modify** | `.config/wt.toml` — remove automation ports |
| **Remove** | `scripts/ios-autoconnect.mjs` — no longer needed (client auto-connects) |

## Future: AI Agent Control

The bridge server becomes a general-purpose channel for AI agents to control any connected client:
- Send UI interactions (click, type, navigate)
- Read screen state (DOM snapshots, screenshots via canvas)
- Drive multi-device test scenarios (e.g. "on iOS, scan QR code shown on macOS")
- Extensible command protocol — new command types without app rebuild
