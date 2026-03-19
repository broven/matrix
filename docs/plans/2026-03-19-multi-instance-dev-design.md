# Multi-Instance Dev Mode & Dev Indicators

**Issues**: [#40](https://github.com/broven/matrix/issues/40), [#43](https://github.com/broven/matrix/issues/43)
**Date**: 2026-03-19

## Problem

1. Sidecar server port 19880 is hardcoded — cannot run multiple Mac app instances simultaneously
2. Dev builds are visually identical to release builds — no way to distinguish them

## Use Case

User runs a stable Matrix release as their development tool, while multiple worktrees each need to preview their own Mac client changes side-by-side.

## Design

### 1. Dynamic Sidecar Port (Dev/Bridge Mode Only)

- New environment variable `SIDECAR_PORT` in `.env.local` (per-worktree)
- **Release mode**: fixed 19880, no env var reading
- **Dev mode** (`debug_assertions`): read `SIDECAR_PORT`, fallback to 19880
- Rust injects actual port as Tauri app state via `manage()`
- Frontend reads port via `invoke` instead of hardcoding

### 2. Window Title (Dev Mode)

- Format: `Matrix [DEV - <worktree-name> :<sidecar-port>]`
- Example: `Matrix [DEV - feature-auth :19881]`
- Release mode: title stays `Matrix`
- Worktree name parsed from current working directory (last path segment)
- Set via `window.set_title()` in Rust setup callback

### 3. Icon DEV Badge (Dev Mode)

- Runtime overlay: red/orange circle badge with white "DEV" text in top-right corner
- Applies to both Dock icon and window title bar icon
- Uses macOS native API via `objc` crate:
  - Get `NSApp.applicationIconImage`
  - Draw circle + text overlay using `NSImage` + `lockFocus`
  - Set back via `NSApp.setApplicationIconImage:`
- One-time operation at startup, no performance impact
- Release mode: no overlay

## Files to Change

| File | Change |
|------|--------|
| `packages/client/src-tauri/src/lib.rs` | Read `SIDECAR_PORT`, inject app state, set window title, overlay icon badge |
| `packages/client/src-tauri/Cargo.toml` | Add `objc`/`cocoa` dependency if needed |
| `packages/client/src/hooks/useMatrixClient.tsx` | Get port from Tauri invoke instead of hardcode |
| `packages/client/src/pages/ConnectPage.tsx` | Same as above |
| Per-worktree `.env.local` | Add `SIDECAR_PORT=<port>` |

## Not Changed

- Release mode behavior (port 19880, title "Matrix", original icon)
- Server package (`packages/server`)
- Existing `MATRIX_PORT`/`CLIENT_PORT`/`HMR_PORT` system
