# Mac Desktop Auto-Update Design

## Overview

Add auto-update functionality to the Matrix Mac desktop app. The app is unsigned, so updates are handled via custom GitHub Releases checking + DMG download + automated install.

## User Flow

```
App Launch → Check for update → New version available?
  → Toast (bottom-right): "v0.2.0 available, update?" [Later] [Update]
  → User clicks "Update" → Background download DMG (progress bar in toast)
  → Download complete → Toast: "Ready to install" [Later] [Install Now]
  → User clicks "Install Now" → Mount DMG → Copy .app to /Applications → Restart
```

- Background check every 6 hours + on launch
- Settings page: manual "Check for Updates" button + current version display
- "Later" dismisses for current cycle (next check in 6h)

## Technical Design

### Rust Side (Tauri Commands)

Three commands in `src-tauri/src/updater.rs`:

#### `check_update()`
- GET `https://api.github.com/repos/{owner}/{repo}/releases/latest`
- Compare `tag_name` (strip `v` prefix) with current app version from `tauri.conf.json`
- Return `{ has_update: bool, version: String, download_url: String, release_notes: String }`
- Find DMG asset by matching `*.dmg` in release assets

#### `download_update(url: String)`
- Download DMG to `~/Library/Caches/com.matrix.client/update.dmg`
- Emit Tauri event `update-download-progress` with `{ downloaded: u64, total: u64 }`
- Return downloaded file path on completion

#### `install_update()`
- Mount DMG: `hdiutil attach <path> -nobrowse -quiet`
- Find .app in mounted volume
- Write a shell script to temp file:
  ```bash
  #!/bin/bash
  sleep 1
  cp -R "/Volumes/Matrix/Matrix.app" "/Applications/Matrix.app"
  open "/Applications/Matrix.app"
  hdiutil detach "/Volumes/Matrix" -quiet
  rm "$0"
  ```
- Execute script detached
- Exit current app process

### Frontend (React)

#### `useAutoUpdate` hook
- State machine: `idle → checking → available → downloading → ready → installing`
- On mount: check immediately, then `setInterval` every 6 hours
- Listen to `update-download-progress` Tauri event for progress
- Track dismissed state per version to avoid re-prompting within same cycle

#### `UpdateToast` component
- Fixed position bottom-right
- States:
  - **available**: Shows version + release notes summary, [Later] [Update] buttons
  - **downloading**: Progress bar with percentage
  - **ready**: [Later] [Install Now] buttons
- Matches existing UI style (shadcn/ui components)

#### Settings page changes
- Add "Check for Updates" button
- Display current version (read from `tauri.conf.json` or Tauri API)
- Show last check time

### File Changes

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `reqwest` (with `stream` feature) |
| `src-tauri/src/updater.rs` | New: three command implementations |
| `src-tauri/src/lib.rs` | Register updater commands |
| `src/hooks/useAutoUpdate.ts` | New: update state management + timer |
| `src/components/UpdateToast.tsx` | New: bottom-right update notification UI |
| `src/pages/SettingsPage.tsx` | Add check-update button + version display |

### Configuration

- GitHub repo owner/name: derived from `Cargo.toml` or hardcoded in updater.rs
- Check interval: 6 hours (21600000ms)
- Cache directory: `~/Library/Caches/com.matrix.client/`
- Install target: `/Applications/Matrix.app` (fixed path)

### Edge Cases

- **No network**: Silent fail on check, retry next cycle
- **Download interrupted**: Clean up partial file, user can retry
- **App not in /Applications**: Not supported (documented assumption)
- **Multiple instances**: Not handled (single instance assumed)
- **Same version re-check**: Skip if current version matches latest
