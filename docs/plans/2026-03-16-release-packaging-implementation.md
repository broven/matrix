# Release & Packaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build GitHub Actions workflows to produce Mac (.dmg), Linux (tarball + Docker), and iPhone (.ipa via AltStore) releases, triggered by git tag push.

**Architecture:** Tauri sidecar pattern for Mac (bundles server binary via `bun build --compile`). Linux ships standalone server binary + static web UI. iPhone is Tauri iOS with remote-only connection. Platform differences handled at runtime in shared React code.

**Tech Stack:** Tauri 2.0, Bun (compile), GitHub Actions, Docker (Alpine), AltStore Source JSON

---

### Task 1: Server — Add CLI argument parsing

**Files:**
- Modify: `packages/server/src/config.ts`

**Step 1: Write the implementation**

Replace `loadConfig()` to parse `process.argv` with CLI args taking priority over env vars:

```typescript
import type { AgentConfig } from "@matrix/protocol";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string | null;
  agents: AgentConfig[];
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

export function loadConfig(): ServerConfig {
  const args = parseArgs();
  return {
    port: parseInt(args.port || process.env.MATRIX_PORT || "8080", 10),
    host: args.host || process.env.MATRIX_HOST || "0.0.0.0",
    dbPath: args.db || process.env.MATRIX_DB_PATH || "./matrix.db",
    webDir: args.web || process.env.MATRIX_WEB_DIR || null,
    agents: [
      {
        id: "claude-code-acp",
        name: "Claude Code",
        command: process.env.CLAUDE_CODE_ACP_PATH || "claude-code-acp",
        args: [],
      },
    ],
  };
}
```

**Step 2: Verify it compiles**

Run: `cd packages/server && pnpm build`
Expected: Clean compile, no errors.

**Step 3: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat(server): add CLI argument parsing (--port, --host, --db, --web)"
```

---

### Task 2: Server — Add static file serving for Web UI

**Files:**
- Modify: `packages/server/src/index.ts`

**Step 1: Add serveStatic middleware**

After the CORS middleware setup (line ~224), add static file serving when `webDir` is configured:

```typescript
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
```

Add after the CORS block and before auth middleware:

```typescript
// Serve static web UI files if configured
if (config.webDir) {
  const resolvedWebDir = path.resolve(config.webDir);
  app.use("/*", serveStatic({ root: resolvedWebDir }));
  console.log(`  Serving web UI from ${resolvedWebDir}`);
}
```

**Important:** The static middleware must be added AFTER auth routes so API routes take priority. Hono matches routes in order, so add it at the very end, before `serve()`:

Actually, a better approach — add a catch-all AFTER all API routes to serve static files and fall back to `index.html` for SPA routing:

```typescript
// After all API routes, before serve()
if (config.webDir) {
  const resolvedWebDir = path.resolve(config.webDir);

  // Serve static assets
  app.get("/*", serveStatic({ root: resolvedWebDir }));

  // SPA fallback: serve index.html for any unmatched GET request
  app.get("/*", serveStatic({ root: resolvedWebDir, path: "index.html" }));
}
```

**Step 2: Verify it compiles**

Run: `cd packages/server && pnpm build`
Expected: Clean compile.

**Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): serve static web UI via --web flag"
```

---

### Task 3: Tauri — Configure sidecar in tauri.conf.json

**Files:**
- Modify: `packages/client/src-tauri/tauri.conf.json`

**Step 1: Enable bundling and add externalBin**

Update `tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Matrix",
  "version": "0.1.0",
  "identifier": "com.matrix.client",
  "build": {
    "beforeBuildCommand": "pnpm build",
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:19823",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Matrix",
        "width": 1280,
        "height": 900,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/matrix-server"],
    "icon": ["icons/32x32.png"]
  }
}
```

Key changes:
- `bundle.active`: `false` → `true`
- Added `bundle.externalBin`: `["binaries/matrix-server"]`

**Step 2: Create binaries directory placeholder**

Run: `mkdir -p packages/client/src-tauri/binaries && echo "placeholder" > packages/client/src-tauri/binaries/.gitkeep`

**Step 3: Add Tauri shell-execute permission**

Update `packages/client/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main Matrix client window.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-kill"
  ]
}
```

**Step 4: Add shell plugin to Cargo.toml**

Add to `packages/client/src-tauri/Cargo.toml` dependencies:

```toml
[dependencies]
tauri = { version = "=2.0.0", features = [] }
tauri-plugin-shell = "=2.0.0"
```

And in `packages/client/package.json` devDependencies, add:

```json
"@tauri-apps/plugin-shell": "^2.0.0"
```

Run: `cd packages/client && pnpm install`

**Step 5: Commit**

```bash
git add packages/client/src-tauri/tauri.conf.json packages/client/src-tauri/capabilities/default.json packages/client/src-tauri/Cargo.toml packages/client/src-tauri/binaries/.gitkeep packages/client/package.json pnpm-lock.yaml
git commit -m "feat(client): configure Tauri sidecar and shell plugin"
```

---

### Task 4: Tauri Rust — Sidecar spawn/kill lifecycle

**Files:**
- Modify: `packages/client/src-tauri/src/lib.rs`

**Step 1: Implement sidecar management**

```rust
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_shell::ShellExt;

                let shell = app.shell();
                let (mut _rx, child) = shell
                    .sidecar("matrix-server")
                    .expect("failed to create sidecar command")
                    .args(["--port", "19880"])
                    .spawn()
                    .expect("failed to spawn matrix-server sidecar");

                // Store the child process so it lives as long as the app
                app.manage(SidecarState(std::sync::Mutex::new(Some(child))));
            }
            Ok(())
        })
        .on_event(|app, event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Matrix client");
}

#[cfg(desktop)]
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
```

**Step 2: Verify it compiles**

Run: `cd packages/client/src-tauri && cargo check`
Expected: Compiles (sidecar binary doesn't need to exist for check).

**Step 3: Commit**

```bash
git add packages/client/src-tauri/src/lib.rs
git commit -m "feat(client): spawn/kill matrix-server sidecar on desktop"
```

---

### Task 5: Client React — Platform detection utility

**Files:**
- Create: `packages/client/src/lib/platform.ts`

**Step 1: Create platform detection**

```typescript
export function isTauri(): boolean {
  return "__TAURI__" in window;
}

export function isMobilePlatform(): boolean {
  // Tauri sets __TAURI_OS_PLUGIN_INTERNALS__ on mobile, but simpler check:
  // On mobile Tauri, the user agent includes "Tauri" and screen is small
  // However, the reliable way is checking if the shell plugin is available
  // Since only desktop bundles the sidecar, we check for that
  if (!isTauri()) return false;
  // iOS/Android Tauri apps don't have the shell plugin
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function hasLocalServer(): boolean {
  return isTauri() && !isMobilePlatform();
}
```

**Step 2: Commit**

```bash
git add packages/client/src/lib/platform.ts
git commit -m "feat(client): add platform detection utility"
```

---

### Task 6: Client React — Auto-connect to local sidecar on desktop

**Files:**
- Modify: `packages/client/src/hooks/useMatrixClient.tsx`

**Step 1: Add auto-connect logic for local sidecar**

At the top of `MatrixClientProvider`, add an effect that auto-connects to the local sidecar on desktop:

```typescript
import { hasLocalServer } from "@/lib/platform";

// Inside MatrixClientProvider, after existing state declarations:

// Auto-connect to local sidecar on desktop
useEffect(() => {
  if (!hasLocalServer()) return;
  if (client) return; // Already connected

  const LOCAL_URL = "http://localhost:19880";

  // Poll until sidecar is ready (it takes a moment to start)
  let cancelled = false;
  const tryConnect = async () => {
    for (let i = 0; i < 30; i++) {
      if (cancelled) return;
      try {
        const res = await fetch(`${LOCAL_URL}/agents`, {
          headers: { Authorization: "Bearer local" },
        });
        if (res.ok) {
          connect({ serverUrl: LOCAL_URL, token: "local" });
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.warn("Local sidecar did not become ready in 15s");
  };

  tryConnect();
  return () => { cancelled = true; };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

**Important note:** The sidecar needs to accept a "local" token or skip auth for local connections. This is addressed in Task 7.

**Step 2: Commit**

```bash
git add packages/client/src/hooks/useMatrixClient.tsx
git commit -m "feat(client): auto-connect to local sidecar on desktop"
```

---

### Task 7: Server — Local mode (skip auth for localhost sidecar)

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Add `--local` flag to config**

In `config.ts`, add to `parseArgs` result usage:

```typescript
export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string | null;
  localMode: boolean; // Skip token auth (for sidecar use)
  agents: AgentConfig[];
}
```

In `loadConfig()`:

```typescript
localMode: args.local === "true" || process.env.MATRIX_LOCAL === "true" || false,
```

**Step 2: In index.ts, when localMode, use a fixed "local" token**

Change the token initialization:

```typescript
const serverToken = config.localMode
  ? "local"
  : (process.env.MATRIX_TOKEN || generateToken());
```

**Step 3: Update sidecar spawn args in lib.rs**

```rust
.args(["--port", "19880", "--local", "true"])
```

**Step 4: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/index.ts packages/client/src-tauri/src/lib.rs
git commit -m "feat(server): add --local mode for sidecar (fixed token)"
```

---

### Task 8: Client React — Settings page for remote connections

**Files:**
- Create: `packages/client/src/pages/SettingsPage.tsx`
- Modify: `packages/client/src/components/layout/AppLayout.tsx`

**Step 1: Create SettingsPage component**

```typescript
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { hasLocalServer } from "@/lib/platform";

interface SavedServer {
  serverUrl: string;
  token: string;
  name: string;
}

const STORAGE_KEY = "matrix:remoteServers";

function loadSavedServers(): SavedServer[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSavedServers(servers: SavedServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { connect, connectionInfo, status } = useMatrixClient();
  const [servers, setServers] = useState(loadSavedServers);
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    if (!newUrl || !newToken) return;
    const server: SavedServer = {
      serverUrl: newUrl,
      token: newToken,
      name: newName || new URL(newUrl).host,
    };
    const updated = [...servers, server];
    setServers(updated);
    saveSavedServers(updated);
    setNewUrl("");
    setNewToken("");
    setNewName("");
  };

  const handleRemove = (index: number) => {
    const updated = servers.filter((_, i) => i !== index);
    setServers(updated);
    saveSavedServers(updated);
  };

  const handleConnect = (server: SavedServer) => {
    connect({ serverUrl: server.serverUrl, token: server.token });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Current connection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="size-4" />
              Current Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <div>Server: {connectionInfo?.serverUrl ?? "-"}</div>
            <div>Status: {status}</div>
            {hasLocalServer() && connectionInfo?.serverUrl?.includes("localhost:19880") && (
              <div className="text-xs text-primary">Local server (sidecar)</div>
            )}
          </CardContent>
        </Card>

        {/* Remote servers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Remote Servers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {servers.map((server, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{server.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{server.serverUrl}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleConnect(server)}>
                  Connect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleRemove(i)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <div className="space-y-3 pt-2 border-t">
              <Input
                placeholder="Server name (optional)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                placeholder="Server URL (https://...)"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Access token"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
              />
              <Button onClick={handleAdd} disabled={!newUrl || !newToken} className="w-full">
                <Plus className="size-4 mr-2" /> Add Remote Server
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Add Settings navigation to AppLayout**

In `AppLayout.tsx`, add a settings button in the sidebar and a state to toggle between app view and settings view. Add a `Settings` (gear) icon button at the bottom of the sidebar that sets `showSettings` state. When `showSettings` is true, render `<SettingsPage onBack={() => setShowSettings(false)} />` instead of the main content area.

**Step 3: Commit**

```bash
git add packages/client/src/pages/SettingsPage.tsx packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat(client): add Settings page for remote server management"
```

---

### Task 9: Client React — Platform-aware ConnectPage for iPhone

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/pages/ConnectPage.tsx`

**Step 1: Update App.tsx routing**

On iPhone (no local server, not in browser), skip auto-connect and go straight to ConnectPage. The existing flow already works — `ConnectPage` shows when no client is connected. No change needed to `App.tsx`.

**Step 2: Update ConnectPage default URL**

In `ConnectPage.tsx`, change the default URL based on platform:

```typescript
import { hasLocalServer } from "@/lib/platform";

// In ConnectPage:
const [serverUrl, setServerUrl] = useState(
  hasLocalServer() ? "http://localhost:19880" : "https://"
);
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/ConnectPage.tsx
git commit -m "feat(client): platform-aware default server URL on ConnectPage"
```

---

### Task 10: Create Dockerfile

**Files:**
- Create: `Dockerfile` (repo root)

**Step 1: Write Dockerfile**

```dockerfile
FROM alpine:3.21
RUN apk add --no-cache libstdc++
COPY matrix-server /usr/local/bin/matrix-server
COPY web/ /app/web/
WORKDIR /app
EXPOSE 3000
CMD ["matrix-server", "--port", "3000", "--web", "/app/web"]
```

Note: `libstdc++` may be needed by Bun-compiled binaries. The actual binary and web assets are copied in by the GitHub Actions workflow (multi-stage not needed since Bun cross-compiles externally).

**Step 2: Create .dockerignore**

```
node_modules
.git
packages
docs
*.md
```

**Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for Alpine-based server image"
```

---

### Task 11: Create AltStore Source JSON

**Files:**
- Create: `altstore-source.json` (repo root)

**Step 1: Write initial source file**

```json
{
  "name": "Matrix",
  "subtitle": "Remote ACP Client",
  "description": "Matrix - Remote ACP client for managing AI agent sessions.",
  "iconURL": "https://raw.githubusercontent.com/broven/matrix/main/packages/client/src-tauri/icons/32x32.png",
  "apps": [
    {
      "name": "Matrix",
      "bundleIdentifier": "com.matrix.client",
      "developerName": "broven",
      "subtitle": "Remote ACP Client",
      "localizedDescription": "Matrix is a remote client for managing AI agent sessions via the ACP protocol. Connect to your Matrix server to interact with Claude Code and other agents.",
      "iconURL": "https://raw.githubusercontent.com/broven/matrix/main/packages/client/src-tauri/icons/32x32.png",
      "tintColor": "#7C3AED",
      "versions": []
    }
  ],
  "news": []
}
```

The `versions` array will be populated by CI on each release.

**Step 2: Commit**

```bash
git add altstore-source.json
git commit -m "feat: add AltStore source JSON for iOS distribution"
```

---

### Task 12: GitHub Actions — Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write
  packages: write

env:
  VERSION: ${{ github.ref_name }}

jobs:
  build-mac:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: pnpm install

      - name: Set version
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          # Update tauri.conf.json version
          cd packages/client/src-tauri
          jq --arg v "$VERSION" '.version = $v' tauri.conf.json > tmp.json && mv tmp.json tauri.conf.json

      - name: Compile server sidecar
        run: |
          bun build --compile packages/server/src/index.ts \
            --outfile packages/client/src-tauri/binaries/matrix-server-aarch64-apple-darwin

      - name: Build Tauri app
        run: |
          cd packages/client
          pnpm tauri build --target aarch64-apple-darwin

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: mac-artifacts
          path: |
            packages/client/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg

  build-linux-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: pnpm install

      - name: Build web UI
        run: cd packages/client && pnpm build

      - name: Compile server (glibc for tarball)
        run: |
          bun build --compile packages/server/src/index.ts \
            --target bun-linux-x64 \
            --outfile matrix-server

      - name: Compile server (musl for Docker)
        run: |
          bun build --compile packages/server/src/index.ts \
            --target bun-linux-x64-musl \
            --outfile matrix-server-musl

      - name: Package tarball
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          DIR="matrix-server-v${VERSION}-linux-x64"
          mkdir -p "${DIR}/web"
          cp matrix-server "${DIR}/"
          cp -r packages/client/dist/* "${DIR}/web/"
          tar czf "${DIR}.tar.gz" "${DIR}"

      - name: Build and push Docker image
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          IMAGE="ghcr.io/${{ github.repository_owner }}/matrix-server"

          # Prepare Docker context
          cp matrix-server-musl matrix-server-docker
          mkdir -p docker-web
          cp -r packages/client/dist/* docker-web/

          # Build with inline Dockerfile
          echo "FROM alpine:3.21
          RUN apk add --no-cache libstdc++
          COPY matrix-server-docker /usr/local/bin/matrix-server
          COPY docker-web/ /app/web/
          WORKDIR /app
          EXPOSE 3000
          CMD [\"matrix-server\", \"--port\", \"3000\", \"--web\", \"/app/web\"]" > Dockerfile.ci

          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker build -f Dockerfile.ci -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" .
          docker push "${IMAGE}:${VERSION}"
          docker push "${IMAGE}:latest"

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-artifacts
          path: matrix-server-v*-linux-x64.tar.gz

  build-ios:
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios

      - name: Install dependencies
        run: pnpm install

      - name: Set version
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          cd packages/client/src-tauri
          jq --arg v "$VERSION" '.version = $v' tauri.conf.json > tmp.json && mv tmp.json tauri.conf.json

      - name: Initialize iOS project
        run: cd packages/client && pnpm tauri ios init

      - name: Build iOS
        run: cd packages/client && pnpm tauri ios build --export-method release-testing

      - name: Package IPA
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          mkdir -p Payload
          cp -r packages/client/src-tauri/gen/apple/build/arm64/Matrix.app Payload/
          zip -r "Matrix_v${VERSION}.ipa" Payload

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ios-artifacts
          path: Matrix_v*.ipa

  create-release:
    needs: [build-mac, build-linux-server, build-ios]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          merge-multiple: true
          path: artifacts/

      - name: Update AltStore source
        run: |
          VERSION="${{ github.ref_name }}"
          VERSION="${VERSION#v}"
          IPA_NAME="Matrix_v${VERSION}.ipa"
          IPA_SIZE=$(stat -c%s "artifacts/${IPA_NAME}" 2>/dev/null || echo 0)
          DOWNLOAD_URL="https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/${IPA_NAME}"
          DATE=$(date +%Y-%m-%d)

          # Update altstore-source.json with new version
          jq --arg v "$VERSION" \
             --arg url "$DOWNLOAD_URL" \
             --arg size "$IPA_SIZE" \
             --arg date "$DATE" \
             '.apps[0].versions = [{
               "version": $v,
               "date": $date,
               "downloadURL": $url,
               "size": ($size | tonumber),
               "minOSVersion": "16.0"
             }] + .apps[0].versions' \
             altstore-source.json > tmp.json && mv tmp.json altstore-source.json

      - name: Commit AltStore source update
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add altstore-source.json
          git commit -m "chore: update AltStore source for ${{ github.ref_name }}" || true
          git push origin HEAD:main

      - name: Create GitHub Release
        run: |
          gh release create "${{ github.ref_name }}" \
            artifacts/* \
            --title "${{ github.ref_name }}" \
            --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/release.yml
git commit -m "feat: add GitHub Actions release workflow for multi-platform builds"
```

---

### Task 13: Verification — Test server CLI args and static serving locally

**Step 1: Test server CLI args**

```bash
cd packages/server
pnpm build
node dist/index.js --port 9999 --local true
# Expected: Server running on port 9999 with token "local"
```

**Step 2: Test static file serving**

```bash
cd packages/client && pnpm build
cd ../..
cd packages/server
node dist/index.js --port 9999 --web ../client/dist --local true
# Expected: Opening http://localhost:9999 in browser shows the React app
```

**Step 3: Test sidecar binary (Mac only)**

```bash
bun build --compile packages/server/src/index.ts --outfile packages/client/src-tauri/binaries/matrix-server-aarch64-apple-darwin
cd packages/client && pnpm tauri dev
# Expected: App launches, sidecar starts, auto-connects to local server
```

---

### Task 14: Final review and tag

**Step 1: Run all tests**

```bash
pnpm test
```

**Step 2: Verify all files are committed**

```bash
git status
```

**Step 3: Tag and push**

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers the GitHub Actions release workflow.
