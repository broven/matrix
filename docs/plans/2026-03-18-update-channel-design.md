# Update Channel Design

Support alpha/beta releases with update channel selection for macOS, Linux, and iOS.

## Decisions

- **Release model**: GitHub Pre-release tags (`v0.5.0-beta.1`), stable tags (`v0.5.0`)
- **Two channels**: `stable` (default) and `beta`
- **No downgrade**: Switching from beta → stable won't downgrade; waits for stable to catch up
- **Single CI workflow**: Same `release.yml`, auto-detect pre-release from tag format

## Version & Tag Format

- Stable: `v0.5.0`
- Pre-release: `v0.5.0-alpha.1`, `v0.5.0-beta.1`, `v0.5.0-rc.1`
- Semver ordering: `0.4.0 < 0.5.0-alpha.1 < 0.5.0-beta.1 < 0.5.0-rc.1 < 0.5.0`

## macOS Client

### Channel Setting
- Settings page: "Update Channel" dropdown (Stable / Beta)
- Stored via `tauri-plugin-store`, key: `update_channel`, default: `"stable"`
- Switching triggers an immediate update check

### updater.rs Changes
- `check_update` accepts `channel` parameter from frontend
- `stable` → `GET /repos/{owner}/{repo}/releases/latest` (existing logic)
- `beta` → `GET /repos/{owner}/{repo}/releases` → first non-draft release (includes pre-releases)
- Version comparison: only update if remote version > current version (semver)

## Linux Server

### install-server.sh Changes

**Specifying channel (same pattern as `--port` and `--token`):**
1. `--channel beta` command line argument
2. Read from `/etc/matrix/config.env` `UPDATE_CHANNEL` value
3. Default: `stable`

**Priority:** CLI arg > config file > default

**Behavior:**
- `stable` → `GET /releases/latest`
- `beta` → `GET /releases` → first non-draft release
- First install: write chosen channel to `config.env` as `UPDATE_CHANNEL`
- Update mode: read from `config.env` if `--channel` not provided
- Log output must display the active channel: `→ Update channel: beta`

### Docker Image Tags
- Stable: `:latest` + `:X.Y.Z`
- Pre-release: `:beta` + `:X.Y.Z-beta.N` (never push `:latest` for pre-releases)

## iOS (AltStore)

### Dual Source Files
- `altstore-source.json` — stable versions only (existing file)
- `altstore-source-beta.json` — all versions (stable + pre-release)

### CI Logic
- Stable release → append to both files
- Pre-release → append to `altstore-source-beta.json` only

### User Experience
- Beta users add a separate AltStore source URL:
  `https://raw.githubusercontent.com/broven/matrix/main/altstore-source-beta.json`

### iOS Version Handling
- iOS bundle version must be pure `X.Y.Z`
- Pre-release builds use build number to distinguish (e.g., `0.5.0` build `1001`)

## CI Workflow (release.yml)

### Channel Detection
```yaml
- name: Detect channel
  run: |
    if [[ "${{ github.ref_name }}" == *-* ]]; then
      echo "PRERELEASE=true" >> $GITHUB_ENV
      echo "CHANNEL=beta" >> $GITHUB_ENV
    else
      echo "PRERELEASE=false" >> $GITHUB_ENV
      echo "CHANNEL=stable" >> $GITHUB_ENV
    fi
```

### Build Steps
No changes — all tags trigger the same build pipeline.

### Release Step Changes
- Set `prerelease: ${{ env.PRERELEASE }}` on GitHub Release creation
- AltStore update:
  - `PRERELEASE=false` → update both `altstore-source.json` and `altstore-source-beta.json`
  - `PRERELEASE=true` → update `altstore-source-beta.json` only
- Docker tags:
  - `PRERELEASE=false` → push `:latest` + `:X.Y.Z`
  - `PRERELEASE=true` → push `:beta` + `:X.Y.Z-beta.N`
- Commit message:
  - Stable: `chore: update AltStore source for vX.Y.Z`
  - Beta: `chore: update AltStore beta source for vX.Y.Z-beta.N`

## Files to Modify

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Channel detection, conditional AltStore update, Docker tag logic, prerelease flag |
| `packages/client/src-tauri/src/updater.rs` | Accept channel param, beta release API endpoint |
| `packages/client/src/hooks/useAutoUpdate.tsx` | Pass channel to check_update, read from store |
| `packages/client/src/pages/SettingsPage.tsx` | Update Channel dropdown UI |
| `scripts/install-server.sh` | `--channel` arg, config persistence, channel-aware version fetch, log output |
| `altstore-source-beta.json` | New file, same structure as altstore-source.json |
