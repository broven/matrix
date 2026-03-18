# Update Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support alpha/beta releases with update channel selection for macOS, Linux, and iOS.

**Architecture:** Two channels (stable/beta) controlled by: UI dropdown on macOS, `--channel` CLI arg on Linux, dual AltStore source files for iOS. CI auto-detects pre-release from tag format. No downgrade when switching beta → stable.

**Tech Stack:** Rust (Tauri commands), React + TypeScript (frontend), Bash (install script), GitHub Actions (CI)

---

### Task 1: Rust — Semver comparison with pre-release support

The current `is_newer_version` in `updater.rs` only handles numeric segments (`0.1.0`). It needs to handle pre-release tags like `0.5.0-beta.1` with correct semver ordering: `0.4.0 < 0.5.0-alpha.1 < 0.5.0-beta.1 < 0.5.0-rc.1 < 0.5.0`.

**Files:**
- Modify: `packages/client/src-tauri/src/updater.rs:38-64` (replace `is_newer_version`)

**Step 1: Write failing tests for pre-release version comparison**

Add these tests to the existing `mod tests` block in `updater.rs:316`:

```rust
// ── pre-release version ordering ────────────────────────────────

#[test]
fn newer_prerelease_less_than_release() {
    // 0.5.0-beta.1 < 0.5.0
    assert!(is_newer_version("0.5.0-beta.1", "0.5.0"));
}

#[test]
fn newer_release_not_newer_than_same_prerelease() {
    // 0.5.0 is NOT newer than 0.5.0 (same base, release > pre)
    // but 0.5.0 IS newer than 0.5.0-beta.1
    assert!(!is_newer_version("0.5.0", "0.5.0-beta.1"));
}

#[test]
fn newer_beta_newer_than_alpha() {
    assert!(is_newer_version("0.5.0-alpha.1", "0.5.0-beta.1"));
}

#[test]
fn newer_rc_newer_than_beta() {
    assert!(is_newer_version("0.5.0-beta.1", "0.5.0-rc.1"));
}

#[test]
fn newer_prerelease_newer_than_previous_stable() {
    assert!(is_newer_version("0.4.0", "0.5.0-beta.1"));
}

#[test]
fn newer_same_prerelease() {
    assert!(!is_newer_version("0.5.0-beta.1", "0.5.0-beta.1"));
}

#[test]
fn newer_prerelease_bump() {
    assert!(is_newer_version("0.5.0-beta.1", "0.5.0-beta.2"));
}

#[test]
fn newer_with_v_prefix_prerelease() {
    assert!(is_newer_version("v0.4.0", "v0.5.0-beta.1"));
}
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/client/src-tauri && cargo test`
Expected: Multiple FAIL — current `is_newer_version` ignores pre-release segments.

**Step 3: Replace `is_newer_version` with semver-aware implementation**

Replace lines 42-64 of `updater.rs` (the `is_newer_version` function) with:

```rust
/// Parse a semver pre-release label into a sortable priority.
/// alpha=0, beta=1, rc=2, anything else=3. No pre-release (stable) is highest.
fn prerelease_ord(pre: &str) -> (u8, u64) {
    if pre.is_empty() {
        return (u8::MAX, 0); // stable sorts highest
    }
    // pre is e.g. "beta.1", "alpha.2", "rc.1"
    let mut parts = pre.splitn(2, '.');
    let label = parts.next().unwrap_or("");
    let num: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let priority = match label {
        "alpha" => 0,
        "beta" => 1,
        "rc" => 2,
        _ => 3,
    };
    (priority, num)
}

/// Semver comparison with pre-release support.
/// Returns true if `latest` is newer than `current`.
///
/// Ordering: 0.4.0 < 0.5.0-alpha.1 < 0.5.0-beta.1 < 0.5.0-rc.1 < 0.5.0
fn is_newer_version(current: &str, latest: &str) -> bool {
    let parse = |v: &str| -> (Vec<u64>, String) {
        let stripped = strip_v_prefix(v);
        // Split "0.5.0-beta.1" into ("0.5.0", "beta.1")
        let (version_part, pre) = stripped.split_once('-').unwrap_or((stripped, ""));
        let nums: Vec<u64> = version_part
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        (nums, pre.to_string())
    };

    let (cur_nums, cur_pre) = parse(current);
    let (lat_nums, lat_pre) = parse(latest);

    // Compare numeric version segments first
    let max_len = cur_nums.len().max(lat_nums.len());
    for i in 0..max_len {
        let c = cur_nums.get(i).copied().unwrap_or(0);
        let l = lat_nums.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }

    // Same numeric version — compare pre-release
    let cur_ord = prerelease_ord(&cur_pre);
    let lat_ord = prerelease_ord(&lat_pre);
    lat_ord > cur_ord
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/client/src-tauri && cargo test`
Expected: All tests PASS including new pre-release tests and existing tests.

**Step 5: Commit**

```
feat: semver comparison with pre-release support
```

---

### Task 2: Rust — `check_update` accepts channel parameter

Add a `channel` parameter to the `check_update` Tauri command. When `channel == "beta"`, fetch all releases (not just latest) and pick the first non-draft one.

**Files:**
- Modify: `packages/client/src-tauri/src/updater.rs:84-127`

**Step 1: Add `GitHubRelease` `draft` and `prerelease` fields**

In the `GitHubRelease` struct (line 17-22), add:

```rust
#[derive(Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    draft: Option<bool>,
    prerelease: Option<bool>,
    assets: Vec<GitHubAsset>,
}
```

**Step 2: Modify `check_update` to accept `channel`**

Replace the `check_update` function (lines 84-127):

```rust
#[tauri::command]
pub async fn check_update(app: AppHandle, channel: Option<String>) -> Result<UpdateInfo, String> {
    let current_version = app.config().version.clone().unwrap_or_default();
    let channel = channel.unwrap_or_else(|| "stable".to_string());

    let client = reqwest::Client::new();

    let release = if channel == "beta" {
        // Fetch all releases, pick the first non-draft
        let url = format!(
            "https://api.github.com/repos/{}/{}/releases?per_page=10",
            GITHUB_OWNER, GITHUB_REPO
        );
        let response = client
            .get(&url)
            .header("User-Agent", "matrix-client")
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("Failed to check for updates: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("GitHub API returned status: {}", response.status()));
        }

        let releases: Vec<GitHubRelease> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse releases: {}", e))?;

        releases
            .into_iter()
            .find(|r| !r.draft.unwrap_or(false))
            .ok_or_else(|| "No releases found".to_string())?
    } else {
        // Stable: fetch latest (existing behavior)
        let url = format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            GITHUB_OWNER, GITHUB_REPO
        );
        let response = client
            .get(&url)
            .header("User-Agent", "matrix-client")
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("Failed to check for updates: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("GitHub API returned status: {}", response.status()));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse release info: {}", e))?
    };

    let latest_version = strip_v_prefix(&release.tag_name);
    let has_update = is_newer_version(&current_version, latest_version);

    let download_url = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(".dmg"))
        .map(|a| a.browser_download_url.clone())
        .unwrap_or_default();

    Ok(UpdateInfo {
        has_update,
        version: latest_version.to_string(),
        download_url,
        release_notes: release.body.unwrap_or_default(),
    })
}
```

**Step 3: Verify it compiles**

Run: `cd packages/client/src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Commit**

```
feat: check_update accepts channel parameter for beta releases
```

---

### Task 3: Frontend — Update channel store and hook

Add channel preference storage using the same `LazyStore` pattern as `useServerStore`, and wire it into `useAutoUpdate`.

**Files:**
- Modify: `packages/client/src/hooks/useAutoUpdate.tsx`

**Step 1: Add channel state and persistence to `useAutoUpdateInternal`**

At the top of `useAutoUpdate.tsx`, add the channel store logic and modify `useAutoUpdateInternal`:

```typescript
import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { isTauri, isMacOS } from "@/lib/platform";

// ... keep existing type definitions (UpdateState, UpdateInfo, DownloadProgress) ...

export type UpdateChannel = "stable" | "beta";

export interface AutoUpdateContext {
  state: UpdateState;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress;
  error: string | null;
  hasChecked: boolean;
  channel: UpdateChannel;
  setChannel: (channel: UpdateChannel) => void;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}
```

Add channel persistence (after the `CHECK_INTERVAL` const):

```typescript
const CHANNEL_STORAGE_KEY = "matrix:update-channel";

let channelStore: any = null;

async function getChannelStore() {
  if (channelStore) return channelStore;
  if (!isTauri()) return null;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    channelStore = new LazyStore("settings.json");
    return channelStore;
  } catch {
    return null;
  }
}

async function loadChannel(): Promise<UpdateChannel> {
  const store = await getChannelStore();
  if (store) {
    const val: string | undefined = await store.get(CHANNEL_STORAGE_KEY);
    if (val === "beta") return "beta";
  }
  return "stable";
}

async function persistChannel(channel: UpdateChannel): Promise<void> {
  const store = await getChannelStore();
  if (store) {
    await store.set(CHANNEL_STORAGE_KEY, channel);
  }
}
```

In `useAutoUpdateInternal`, add channel state:

```typescript
const [channel, setChannelState] = useState<UpdateChannel>("stable");
```

Add `useEffect` to load channel on mount:

```typescript
useEffect(() => {
  loadChannel().then(setChannelState);
}, []);
```

Add `setChannel` callback:

```typescript
const setChannel = useCallback((ch: UpdateChannel) => {
  setChannelState(ch);
  persistChannel(ch);
  // Trigger an update check with new channel after a tick
  setTimeout(() => checkForUpdate(), 0);
}, [checkForUpdate]);
```

Modify `checkForUpdate` to pass channel to the Tauri command:

```typescript
const result = await invoke<{
  has_update: boolean;
  version: string;
  download_url: string;
  release_notes: string;
}>("check_update", { channel });
```

Note: `checkForUpdate` must include `channel` in its dependency array. Since `channel` changes trigger re-creation of `checkForUpdate`, and `checkForUpdate` is used in the interval `useEffect`, the interval will reset — this is desired behavior.

Return `channel` and `setChannel` from the hook and provider.

**Step 2: Verify it compiles**

Run: `cd packages/client && pnpm tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: update channel preference with persistence
```

---

### Task 4: Frontend — Settings UI for update channel

Add a dropdown to the Settings page to select the update channel.

**Files:**
- Modify: `packages/client/src/pages/SettingsPage.tsx:92-136`

**Step 1: Add channel dropdown to the About card**

In `SettingsPage.tsx`, destructure `channel` and `setChannel` from `useAutoUpdate()` (line 15):

```typescript
const { state: updateState, updateInfo, checkForUpdate, error: updateError, hasChecked, channel, setChannel } = useAutoUpdate();
```

Add the dropdown inside the `<CardContent>` of the About card, after the version line (after line 104) and before the check button:

```tsx
<div className="flex items-center gap-2 text-muted-foreground">
  <span>Update Channel:</span>
  <select
    value={channel}
    onChange={(e) => setChannel(e.target.value as "stable" | "beta")}
    className="rounded border bg-background px-2 py-1 text-sm"
  >
    <option value="stable">Stable</option>
    <option value="beta">Beta</option>
  </select>
</div>
```

**Step 2: Verify it compiles**

Run: `cd packages/client && pnpm tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: update channel selector in Settings page
```

---

### Task 5: Linux — `install-server.sh` channel support

Add `--channel` argument parsing, channel-aware version fetching, config persistence, and channel logging.

**Files:**
- Modify: `scripts/install-server.sh`

**Step 1: Add `--channel` to `parse_args`**

Add `CHANNEL=""` initialization and case branch in `parse_args()` (after the `--token` case):

```bash
parse_args() {
  PORT=""
  TOKEN=""
  CHANNEL=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port)
        [ $# -ge 2 ] || fatal "--port requires a value"
        PORT="$2"
        [[ "$PORT" =~ ^[0-9]+$ ]] || fatal "--port must be a number, got: ${PORT}"
        shift 2
        ;;
      --token)
        [ $# -ge 2 ] || fatal "--token requires a value"
        TOKEN="$2"
        shift 2
        ;;
      --channel)
        [ $# -ge 2 ] || fatal "--channel requires a value"
        CHANNEL="$2"
        [[ "$CHANNEL" =~ ^(stable|beta)$ ]] || fatal "--channel must be 'stable' or 'beta', got: ${CHANNEL}"
        shift 2
        ;;
      *)
        fatal "Unknown option: $1"
        ;;
    esac
  done
}
```

**Step 2: Replace `get_latest_version` with channel-aware version**

Replace the `get_latest_version` function:

```bash
get_latest_version() {
  local channel=$1
  local response

  if [ "$channel" = "beta" ]; then
    # Fetch all releases, pick first non-draft
    local api_url="https://api.github.com/repos/${REPO}/releases?per_page=5"
    response=$(fetch "$api_url") || fatal "Failed to fetch releases from GitHub"
    # Extract first tag_name (first release in array is newest)
    echo "$response" | grep -o '"tag_name":\s*"[^"]*"' | head -1 | cut -d'"' -f4
  else
    # Stable: fetch latest
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    response=$(fetch "$api_url") || fatal "Failed to fetch latest release from GitHub"
    echo "$response" | grep -o '"tag_name":\s*"[^"]*"' | head -1 | cut -d'"' -f4
  fi
}
```

**Step 3: Update `main` to resolve channel and log it**

Update the `main` function to resolve channel priority (CLI > config > default), log it, and persist:

```bash
main() {
  parse_args "$@"
  preflight

  # Resolve channel: CLI arg > config file > default
  if [ -z "$CHANNEL" ] && [ -f "$CONFIG_FILE" ]; then
    CHANNEL=$(grep -oP '^UPDATE_CHANNEL="\K[^"]+' "$CONFIG_FILE" 2>/dev/null || true)
  fi
  CHANNEL="${CHANNEL:-stable}"
  info "Update channel: ${CHANNEL}"

  local latest_version
  latest_version=$(get_latest_version "$CHANNEL")
  [ -z "$latest_version" ] && fatal "Could not determine latest version"

  if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
    # --- Update mode ---
    info "Existing installation detected — updating..."

    download_binary "$latest_version"

    systemctl restart "$SERVICE_NAME"
    ok "Updated to ${latest_version}"
    echo
    info "Check status: systemctl status ${SERVICE_NAME}"
  else
    # --- Install mode ---
    info "Installing Matrix Server..."

    download_binary "$latest_version"

    # Determine port
    if [ -z "$PORT" ]; then
      if [ -t 0 ]; then
        printf 'Port [8080]: '
        read -r PORT
      fi
      PORT="${PORT:-8080}"
    fi

    # Determine token
    if [ -z "$TOKEN" ]; then
      TOKEN=$(generate_token)
      info "Generated auth token (save this): ${TOKEN}"
    fi

    configure "$PORT" "$TOKEN"
    install_service

    echo
    ok "Matrix Server is running!"
    echo
    echo "  URL:    http://$(hostname -f 2>/dev/null || hostname):${PORT}"
    echo "  Token:  ${TOKEN}"
    echo
    info "Check status: systemctl status ${SERVICE_NAME}"
    info "View logs:    journalctl -u ${SERVICE_NAME} -f"
    info "Edit config:  ${CONFIG_FILE}"
  fi
}
```

**Step 4: Add `UPDATE_CHANNEL` to `configure` function**

Update the `configure` function to include channel:

```bash
configure() {
  local port=$1 token=$2

  mkdir -p "$CONFIG_DIR" "$DATA_DIR"

  # Create dedicated system user
  if ! id -u matrix &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin matrix
    info "Created system user: matrix"
  fi

  chown -R matrix:matrix "$DATA_DIR"

  cat > "$CONFIG_FILE" <<EOF
MATRIX_PORT="${port}"
MATRIX_TOKEN="${token}"
MATRIX_HOST="0.0.0.0"
MATRIX_DB_PATH="${DATA_DIR}/matrix.db"
MATRIX_WEB_DIR="${DATA_DIR}/web"
UPDATE_CHANNEL="${CHANNEL}"
EOF

  chmod 600 "$CONFIG_FILE"
  ok "Configuration written to ${CONFIG_FILE}"
}
```

**Step 5: Commit**

```
feat: install-server.sh --channel flag with config persistence
```

---

### Task 6: CI — Channel detection and pre-release flag

Add channel detection to `release.yml` and set the GitHub Release `prerelease` flag.

**Files:**
- Modify: `.github/workflows/release.yml`

**Step 1: Add channel detection step at the top of each job that needs it**

In the `create-release` job, after `actions/checkout@v4`, add:

```yaml
      - name: Detect channel
        run: |
          if [[ "${{ github.ref_name }}" == *-* ]]; then
            echo "PRERELEASE=true" >> $GITHUB_ENV
          else
            echo "PRERELEASE=false" >> $GITHUB_ENV
          fi
```

**Step 2: Update GitHub Release creation to use prerelease flag**

Replace the "Create GitHub Release" step:

```yaml
      - name: Create GitHub Release
        run: |
          PRERELEASE_FLAG=""
          if [ "$PRERELEASE" = "true" ]; then
            PRERELEASE_FLAG="--prerelease"
          fi
          gh release create "${{ github.ref_name }}" \
            artifacts/* \
            --title "${{ github.ref_name }}" \
            --generate-notes \
            $PRERELEASE_FLAG
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 3: Commit**

```
feat: CI detects pre-release tags and sets GitHub Release flag
```

---

### Task 7: CI — Conditional AltStore source updates

Update the AltStore step to conditionally update `altstore-source.json` (stable only) and `altstore-source-beta.json` (always).

**Files:**
- Create: `altstore-source-beta.json`
- Modify: `.github/workflows/release.yml`

**Step 1: Create `altstore-source-beta.json`**

Copy from `altstore-source.json` — same structure, same existing versions. This becomes the beta source file that includes all releases.

```json
{
  "name": "Matrix (Beta)",
  "subtitle": "Remote ACP Client — Beta Channel",
  "description": "Matrix Beta — Pre-release builds. May contain bugs.",
  "iconURL": "https://raw.githubusercontent.com/broven/matrix/main/packages/client/src-tauri/icons/32x32.png",
  "apps": [
    {
      "name": "Matrix",
      "bundleIdentifier": "com.matrix.client",
      "developerName": "broven",
      "subtitle": "Remote ACP Client (Beta)",
      "localizedDescription": "Matrix is a remote client for managing AI agent sessions via the ACP protocol. This is the beta channel with pre-release builds.",
      "iconURL": "https://raw.githubusercontent.com/broven/matrix/main/packages/client/src-tauri/icons/32x32.png",
      "tintColor": "#F59E0B",
      "versions": []
    }
  ],
  "news": []
}
```

Note: Start with empty versions array. The CI will populate it going forward. Existing stable versions can be copied over if desired, but it's not required.

**Step 2: Replace "Update AltStore source" step in release.yml**

Replace the existing "Update AltStore source" and "Commit AltStore source update" steps:

```yaml
      - name: Update AltStore sources
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          IOS_VERSION=$(echo "$VERSION" | sed 's/-.*//')
          IPA_NAME="Matrix_v${VERSION}.ipa"
          IPA_SIZE=$(stat -c%s "artifacts/${IPA_NAME}" 2>/dev/null || echo 0)
          DOWNLOAD_URL="https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/${IPA_NAME}"
          DATE=$(date +%Y-%m-%d)

          NEW_ENTRY=$(jq -n \
            --arg v "$IOS_VERSION" \
            --arg url "$DOWNLOAD_URL" \
            --arg size "$IPA_SIZE" \
            --arg date "$DATE" \
            '{
              "version": $v,
              "date": $date,
              "downloadURL": $url,
              "size": ($size | tonumber),
              "minOSVersion": "16.0"
            }')

          # Always update beta source
          jq --argjson entry "$NEW_ENTRY" \
            '.apps[0].versions = [$entry] + .apps[0].versions' \
            altstore-source-beta.json > tmp.json && mv tmp.json altstore-source-beta.json

          # Only update stable source for non-prerelease
          if [ "$PRERELEASE" = "false" ]; then
            jq --argjson entry "$NEW_ENTRY" \
              '.apps[0].versions = [$entry] + .apps[0].versions' \
              altstore-source.json > tmp.json && mv tmp.json altstore-source.json
          fi

      - name: Commit AltStore source update
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add altstore-source.json altstore-source-beta.json
          if [ "$PRERELEASE" = "true" ]; then
            git commit -m "chore: update AltStore beta source for ${{ github.ref_name }}" || true
          else
            git commit -m "chore: update AltStore source for ${{ github.ref_name }}" || true
          fi
          git push origin HEAD:main
```

**Step 3: Commit**

```
feat: dual AltStore source files for stable/beta channels
```

---

### Task 8: CI — Conditional Docker image tags

Pre-release builds should push `:beta` + `:X.Y.Z-beta.N` tags, not `:latest`.

**Files:**
- Modify: `.github/workflows/release.yml` (build-linux-server job)

**Step 1: Add channel detection to `build-linux-server` job**

Add the same detection step after `actions/checkout@v4` in `build-linux-server`:

```yaml
      - name: Detect channel
        run: |
          if [[ "${{ github.ref_name }}" == *-* ]]; then
            echo "PRERELEASE=true" >> $GITHUB_ENV
          else
            echo "PRERELEASE=false" >> $GITHUB_ENV
          fi
```

**Step 2: Update Docker build step to conditionally tag**

Replace the Docker tag lines in the "Build and push Docker image" step:

```yaml
      - name: Build and push Docker image
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          IMAGE="ghcr.io/${{ github.repository_owner }}/matrix-server"

          cp matrix-server-musl matrix-server-docker
          mkdir -p docker-web
          cp -r packages/client/dist/* docker-web/

          cat > Dockerfile.ci <<'DOCKERFILE'
          FROM alpine:3.21
          RUN apk add --no-cache libstdc++
          COPY matrix-server-docker /usr/local/bin/matrix-server
          COPY docker-web/ /app/web/
          WORKDIR /app
          EXPOSE 3000
          CMD ["matrix-server", "--port", "3000", "--web", "/app/web"]
          DOCKERFILE

          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin

          if [ "$PRERELEASE" = "true" ]; then
            docker build -f Dockerfile.ci -t "${IMAGE}:${VERSION}" -t "${IMAGE}:beta" .
            docker push "${IMAGE}:${VERSION}"
            docker push "${IMAGE}:beta"
          else
            docker build -f Dockerfile.ci -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" .
            docker push "${IMAGE}:${VERSION}"
            docker push "${IMAGE}:latest"
          fi
```

**Step 3: Commit**

```
feat: conditional Docker tags for pre-release builds
```

---

### Task 9: Verify everything compiles and tests pass

**Step 1: Run Rust tests**

Run: `cd packages/client/src-tauri && cargo test`
Expected: All tests PASS.

**Step 2: Run frontend type check**

Run: `cd packages/client && pnpm tsc --noEmit`
Expected: No type errors.

**Step 3: Verify the bash script syntax**

Run: `bash -n scripts/install-server.sh`
Expected: No syntax errors.

**Step 4: Final commit (if any remaining changes)**

```
chore: verify all components compile and pass tests
```
