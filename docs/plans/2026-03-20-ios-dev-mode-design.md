# iOS Dev Mode & Fixed-Port Automation Bridge

**Date:** 2026-03-20
**Status:** Approved

## Goal

Add `dev:ios` support so the Matrix iPhone version can launch in the iOS Simulator with the automation bridge active. Simultaneously, migrate the bridge from random-port + discovery-file to fixed-port-per-platform, simplifying detection and eliminating filesystem coupling.

## Architecture Decisions

- **Shared server**: `dev:mac` and `dev:ios` share the same Vite dev server and matrix-server instance. Wireit deduplicates shared dependencies.
- **Tauri picks the simulator**: No explicit `--target` flag; Tauri selects the default iOS Simulator.
- **Server URL via env var**: The iOS app reads `MATRIX_DEV_SERVER_URL` from env at build time to know where the matrix-server is. No sidecar concept on iOS.
- **Fixed ports**: Automation bridge uses fixed ports from env vars, no discovery file. Detection = TCP connect to known port.
- **iOS Simulator networking**: The simulator shares the host's network stack. `TcpListener::bind("127.0.0.1:PORT")` works and is accessible from the host.

## Port Allocation Scheme

```
.env.local (per worktree):
  MATRIX_PORT=8080                    # matrix-server (shared)
  CLIENT_PORT=5173                    # Vite dev server (shared)
  MATRIX_AUTOMATION_PORT=18765        # bridge: macOS desktop
  MATRIX_AUTOMATION_PORT_IOS=18766    # bridge: iOS simulator
  MATRIX_AUTOMATION_TOKEN=dev         # fixed token (shared)
```

Each worktree gets unique ports assigned at creation time:

| Worktree  | MATRIX_PORT | CLIENT_PORT | AUTOMATION_PORT | AUTOMATION_PORT_IOS |
|-----------|-------------|-------------|-----------------|---------------------|
| iphone    | 8080        | 5173        | 18765           | 18766               |
| feature-x | 8081        | 5174        | 18767           | 18768               |

## Wireit Task Structure

### Root `package.json`

```
dev:mac  → [protocol:dev, sdk:dev, server:dev:mac, client:dev:mac]
dev:ios  → [protocol:dev, sdk:dev, server:dev:mac, client:dev:ios]
dev:all  → [protocol:dev, sdk:dev, server:dev:mac, client:dev:mac, client:dev:ios]
```

### Client `package.json`

```
dev:ios:
  command: tauri ios dev (with SKIP_SIDECAR=true, devUrl from CLIENT_PORT)
  service: true
  dependencies: [dev, ../server:dev:mac]
```

Wireit deduplicates `dev` (Vite) and `server:dev:mac` when running `dev:all`.

## Rust Changes

### `lib.rs`

1. Add `#[cfg(mobile)]` setup hook:
   - Read `MATRIX_AUTOMATION_PORT_IOS` (fallback to `MATRIX_AUTOMATION_PORT`)
   - Read `MATRIX_AUTOMATION_TOKEN` (default: `"dev"`)
   - Read `MATRIX_DEV_SERVER_URL` for server connection
   - Start automation bridge using existing `ios_sim.rs` adapter
   - No sidecar logic

2. Modify `#[cfg(desktop)]` setup:
   - Read `MATRIX_AUTOMATION_TOKEN` instead of generating random token
   - Remove `write_discovery_file()` call
   - Port already comes from `MATRIX_AUTOMATION_PORT` env var (existing)

### `automation/state.rs`

- Remove `write_discovery_file()`, `generate_token()`, and all discovery-file-related code
- Simplify `AutomationState::new()` to accept port + token from caller

### Conditional compilation

```rust
#[cfg(all(mobile, any(test, debug_assertions)))]   // iOS sim bridge
#[cfg(all(desktop, any(test, debug_assertions)))]   // macOS bridge (existing)
```

## Test Runner Changes

### `global-setup.ts` / `setup.ts` / `bridge-client.ts`

- Read `MATRIX_AUTOMATION_PORT` + `MATRIX_AUTOMATION_TOKEN` from env
- Construct `baseUrl = http://127.0.0.1:${port}`
- Remove all `automation.json` discovery file parsing

### `wait-for-bridge.mjs`

- Simplify to TCP port check on known port

## File Change List

| File | Change |
|------|--------|
| `package.json` (root) | Add `dev:ios`, `dev:all` wireit tasks |
| `packages/client/package.json` | Add `dev:ios` wireit task |
| `packages/client/src-tauri/src/lib.rs` | Add mobile setup; remove discovery writes; read fixed port/token |
| `packages/client/src-tauri/src/automation/state.rs` | Remove discovery file code; simplify to port+token holder |
| `tests/e2e/mac/global-setup.ts` | Env-based port+token instead of discovery file |
| `tests/e2e/mac/setup.ts` | Same |
| `tests/e2e/mac/lib/bridge-client.ts` | Remove discovery parsing, accept port+token |
| `tests/e2e/mac/scripts/wait-for-bridge.mjs` | Simplify to TCP check |
| `.env` | Add default automation port/token vars |

## What Does NOT Change

- `server.rs`, `router.rs`, `ios_sim.rs`, `desktop.rs`, `composite.rs`, `webview.rs` — bridge protocol untouched
- `bridge.ts`, `test-hooks.ts` — frontend bridge untouched
- Existing test flow files — use `ui.ts` helpers, not bridge directly
