# Bridge Server-Client Implementation Plan

**Date:** 2026-03-20
**Design:** `docs/plans/2026-03-20-bridge-server-client-design.md`

## Overview

Migrate the automation bridge from an embedded Rust HTTP server inside the app to a WebSocket-based server-client architecture where:
- Bridge Server lives in `packages/server` (existing process, existing port)
- App webviews connect as WebSocket clients
- Test runners interact via HTTP API on the same server
- The entire Rust `automation/` module is deleted

## Batch 1: Bridge Server (packages/server)

**Goal:** Add the bridge server module with WebSocket endpoint and HTTP API routes. No consumers yet — this is purely additive.

### Files to Create

1. **`packages/server/src/bridge/protocol.ts`** — TypeScript types for the WebSocket protocol
   - `BridgeClientMessage`: union of `register`, `response`, `heartbeat`
   - `BridgeServerMessage`: union of `eval`, `event`, `reset`
   - `BridgeClientInfo`: `{ clientId, platform, label, userAgent, connectedAt }`
   - Request/response ID types

2. **`packages/server/src/bridge/client-registry.ts`** — Multi-client management
   - `ClientRegistry` class with `Map<clientId, { ws, info, pendingRequests }>`
   - `register(ws, platform, label, userAgent)` — generates `clientId = "{platform}-{label}"`, handles duplicates with `-2` suffix
   - `unregister(clientId)` — removes client, rejects pending requests
   - `getClient(clientId?)` — resolve target: explicit ID, single-client default, first-registered fallback
   - `listClients()` — returns array of `BridgeClientInfo`
   - `sendRequest(clientId, message)` — returns `Promise<response>` with configurable timeout, stores in `pendingRequests` map keyed by `requestId`
   - `handleResponse(clientId, requestId, result, error)` — resolves the pending promise

3. **`packages/server/src/bridge/index.ts`** — WebSocket upgrade handler + HTTP route registration
   - Export `setupBridge(app, deps)` function following the pattern of `setupWebSocket`
   - WebSocket endpoint at `GET /bridge` — upgrades connection, authenticates via `?token=` query param
   - On WS message: dispatch `register` to registry, dispatch `response` to resolve pending request, dispatch `heartbeat` as no-op
   - HTTP routes (all under `/bridge/`, all using `authMiddleware`):
     - `GET /bridge/clients` — list connected clients
     - `GET /bridge/health` — bridge status + client count
     - `POST /bridge/eval` — body `{ clientId?, script }` — sends eval to client via WS, blocks until response
     - `POST /bridge/event` — body `{ clientId?, name, payload? }` — sends event dispatch to client
     - `POST /bridge/reset` — body `{ clientId?, scopes? }` — sends reset to client
     - `POST /bridge/wait` — body `{ clientId?, condition, timeoutMs?, intervalMs? }` — polls eval on client until condition met

### Files to Modify

4. **`packages/server/src/index.ts`** — Wire up the bridge module
   - Import `setupBridge` from `./bridge/index.js`
   - Add `/bridge` to the skip list in static file serving middleware
   - Call `setupBridge(app, { serverToken, clientRegistry })` after REST routes

### Verification

- `pnpm --filter @matrix/server build` compiles without errors
- Manual test: start server, connect with `wscat`, send register message, verify `GET /bridge/clients` shows the client

---

## Batch 2: JS Bridge Client (packages/client)

**Goal:** Refactor `packages/client/src/automation/bridge.ts` from a Tauri event listener into a WebSocket client that connects to the bridge server.

### Files to Modify

1. **`packages/client/src/automation/bridge.ts`** — Major refactor
   - Remove all Tauri event imports (`@tauri-apps/api/event`)
   - Remove `installAutomationRuntimeBridgeListener` export entirely
   - Keep `installAutomationBridge` — it still installs `window.__MATRIX_AUTOMATION__`
   - Add new export `connectBridgeWebSocket(serverUrl, token, platform, label)`:
     - Opens `ws://{serverUrl}/bridge?token={token}`
     - Sends register message with platform + label
     - Listens for incoming messages (eval, event, reset) and responds
     - Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
   - Keep `shouldInstallBridge`, `toJsonSafe`, `toScriptError`, `executeScript`, `getSnapshot`

2. **`packages/client/src/main.tsx`** — Update initialization
   - Remove `installAutomationRuntimeBridgeListener` call
   - After `installAutomationBridge()`, call `connectBridgeWebSocket()` if `shouldInstallBridge()` is true
   - Derive server URL from `getLocalServerUrl()` (desktop) or URL params (iOS)
   - Derive token from `fetch("/api/auth-info")`
   - Platform: `isMobilePlatform() ? "ios" : "macos"`

### Verification

- `pnpm --filter @matrix/client build` compiles without errors
- `pnpm --filter @matrix/client test` passes
- Manual test: run server + client in dev mode, verify `GET /bridge/clients` shows `macos-main`
- Manual test: `POST /bridge/eval` with `{ "script": "document.title" }` returns the page title

---

## Batch 3: Test Runner Migration (tests/e2e/mac)

**Goal:** Update the test runner's bridge client to use the new HTTP endpoints on the matrix server.

### Files to Modify

1. **`tests/e2e/mac/lib/bridge-client.ts`** — Rewrite
   - Remove `loadDiscovery()` and discovery file parsing
   - `createBridgeClient()` reads `MATRIX_PORT` and `MATRIX_TOKEN` from env
   - Remap all methods to new `/bridge/*` endpoints:
     - `eval(script)` → `POST /bridge/eval`
     - `event(name, payload)` → `POST /bridge/event`
     - `reset(scopes)` → `POST /bridge/reset`
     - `wait(condition, opts)` → `POST /bridge/wait`
     - `health()` → `GET /bridge/health`
     - `mockFileDialog(path)` → `POST /bridge/eval` with `invoke('mock_file_dialog', { path })`

2. **`tests/e2e/mac/setup.ts`** — Update health check
   - Check for `bridge.health()` with `clientCount > 0` instead of `webviewReady`

3. **`tests/e2e/mac/global-setup.ts`** — Simplify
   - Remove discovery file reading
   - Server URL from env `MATRIX_PORT`, token from `MATRIX_TOKEN`
   - Reload webview via `POST /bridge/eval` with `window.location.reload()`

4. **`tests/e2e/mac/lib/ui.ts`** — Minimal changes (only if `bridge.eval()` signature changes)

### Verification

- All 11 test flows pass against a running dev instance

---

## Batch 4: Remove Rust Automation Module

**Goal:** Delete the entire Rust automation module and all related initialization code.

### Files to Delete

1. **`packages/client/src-tauri/src/automation/`** — entire directory

### Files to Modify

2. **`packages/client/src-tauri/src/lib.rs`** — Major cleanup
   - Remove `mod automation;` declaration
   - Remove `AutomationServerState` struct
   - Remove `append_automation_startup_log` and related functions
   - Remove `TauriWindowFacade`, `TauriSidecarFacade` structs and impls
   - Remove `initialize_automation_runtime` and `initialize_mobile_automation` functions
   - Remove the mobile setup block
   - Add `mock_file_dialog` as a `#[tauri::command]` with `Mutex<Option<String>>` state

### Verification

- `TAURI_CONFIG='{"bundle":{"externalBin":[]}}' cargo check` compiles for desktop
- Dev mode app launches, `GET /bridge/clients` shows client connected via JS

---

## Batch 5: Port Cleanup and Config

**Goal:** Remove automation-specific ports and env vars, simplify wt.toml.

### Files to Modify

1. **`.config/wt.toml`** — Remove automation ports (base+4, base+5), update kill-ports to 0-3
2. **`.env`** — Remove `MATRIX_AUTOMATION_PORT`, `MATRIX_AUTOMATION_PORT_IOS`, `MATRIX_AUTOMATION_TOKEN`
3. **`packages/client/AUTOMATION.md`** — Update documentation for new architecture
4. **`packages/client/AUTOMATION_FOR_AI.md`** — Update AI-facing docs
5. **`scripts/smoke-mac-automation.sh`** — Update to use `/bridge/health`

### Files to Delete

6. **`scripts/ios-autoconnect.mjs`** — No longer needed (JS bridge auto-connects)
7. **`tests/e2e/mac/scripts/wait-for-bridge.mjs`** — Replace with simple `/bridge/health` check

### Verification

- `pnpm dev:mac` starts cleanly
- `pnpm dev:ios` starts, app connects to bridge
- `pnpm test:e2e:mac` passes all flows

---

## Dependency Graph

```
Batch 1 (Server bridge module)
  ↓
Batch 2 (JS bridge client) ← depends on Batch 1
  ↓
Batch 3 (Test runner migration) ← depends on Batch 1
  ↓
Batch 4 (Remove Rust module) ← depends on Batch 2 + 3
  ↓
Batch 5 (Port cleanup) ← depends on Batch 4
```

## Risk Notes

- **WebSocket sharing**: Verify `@hono/node-ws` supports two WS routes (`/ws` and `/bridge`) on the same Hono app
- **Auth for bridge WS**: Uses query param `?token=` — simpler for programmatic clients
- **mockFileDialog migration**: Tests call via `POST /bridge/eval` which runs JS that calls `invoke('mock_file_dialog', { path })`
- **Screenshot capability**: Lost in this migration. Can be re-added later via canvas-based approach
