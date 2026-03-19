# Wireit Dev Mac Design

## Goal

Add a `pnpm dev:mac` command that starts a full development macOS app using live dev servers (not prebuilt sidecar binary), orchestrated by [wireit](https://github.com/google/wireit).

## Problem

Current `tauri:dev` spawns the prebuilt sidecar binary (`matrix-server-aarch64-apple-darwin`) for the backend. The frontend hot-reloads via Vite, but backend changes require rebuilding the sidecar. This slows down full-stack development.

## Design

### Task Dependency Graph

```
pnpm dev:mac (root)
│
├── @matrix/protocol:dev     (tsc --watch, service)
├── @matrix/sdk:dev           (tsc --watch, service, depends on protocol)
├── @matrix/server:dev:mac    (bun --watch, service, depends on protocol)
└── @matrix/client:dev:mac    (tauri dev, service, depends on client:dev + server:dev:mac)
     └── @matrix/client:dev   (vite, service, depends on protocol + sdk)
```

### Key Decisions

1. **Skip sidecar in dev mode**: Add `SKIP_SIDECAR` env var to Rust code (`lib.rs`). When `SKIP_SIDECAR=true`, Tauri app skips spawning the sidecar binary.

2. **Route frontend to dev server**: Set `SIDECAR_PORT=MATRIX_PORT` so `getLocalServerUrl()` returns the live dev server address. No frontend code changes needed.

3. **Separate dev database**: `server:dev:mac` uses `--db-path ./data/dev.db` (relative to server package), isolated from sidecar's `~/Library/Application Support/com.matrix.client/matrix.db`.

4. **Remove `beforeDevCommand`**: Delete from `tauri.conf.json`. Wireit manages all startup orchestration.

5. **Bridge**: No changes needed. Tauri dev builds automatically enable the Rust automation server and frontend bridge.

### File Changes

| File | Change |
|------|--------|
| `package.json` | Add `wireit` devDep, add `dev:mac` script + wireit config |
| `packages/protocol/package.json` | `dev` script → wireit service |
| `packages/sdk/package.json` | `dev` script → wireit service, depends on protocol |
| `packages/server/package.json` | New `dev:mac` wireit service, `--local true --db-path ./data/dev.db` |
| `packages/client/package.json` | `dev` → wireit service, new `dev:mac` with `SKIP_SIDECAR=true` |
| `packages/client/src-tauri/tauri.conf.json` | Delete `beforeDevCommand` |
| `packages/client/src-tauri/src/lib.rs` | Add `SKIP_SIDECAR` env var check in `initialize_desktop_runtime()` |
| `packages/server/.gitignore` | Add `data/` |

### Wireit Configuration

**Root** (`package.json`):
```json
{
  "scripts": { "dev:mac": "wireit" },
  "wireit": {
    "dev:mac": {
      "dependencies": [
        "./packages/protocol:dev",
        "./packages/sdk:dev",
        "./packages/server:dev:mac",
        "./packages/client:dev:mac"
      ]
    }
  }
}
```

**protocol**:
```json
{
  "wireit": {
    "dev": {
      "command": "tsc --watch --preserveWatchOutput",
      "service": true
    }
  }
}
```

**sdk**:
```json
{
  "wireit": {
    "dev": {
      "command": "tsc --watch --preserveWatchOutput",
      "service": true,
      "dependencies": ["../protocol:dev"]
    }
  }
}
```

**server**:
```json
{
  "wireit": {
    "dev:mac": {
      "command": "bun --watch --env-file=../../.env --env-file=../../.env.local src/index.ts -- --local true --db-path ./data/dev.db",
      "service": true,
      "dependencies": ["../protocol:dev"]
    }
  }
}
```

**client**:
```json
{
  "wireit": {
    "dev": {
      "command": "sh -c 'set -a; [ -f ../../.env.local ] && . ../../.env.local; set +a; exec vite'",
      "service": true,
      "dependencies": ["../protocol:dev", "../sdk:dev"]
    },
    "dev:mac": {
      "command": "sh -c 'set -a; [ -f ../../.env.local ] && . ../../.env.local; set +a; SKIP_SIDECAR=true SIDECAR_PORT=$MATRIX_PORT exec tauri dev'",
      "service": true,
      "dependencies": ["dev", "../server:dev:mac"]
    }
  }
}
```

### Rust Change (`lib.rs`)

```rust
fn initialize_desktop_runtime(app: &mut tauri::App) {
    let sidecar_port = resolve_sidecar_port();

    let skip_sidecar = std::env::var("SKIP_SIDECAR")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if !skip_sidecar {
        // existing sidecar spawn logic...
    }

    app.manage(SidecarPortState(sidecar_port));
}
```

### What Stays the Same

- `pnpm dev` and `tauri:dev` — original flow unaffected
- CORS — local mode already allows all origins
- Frontend connection logic — `SIDECAR_PORT=MATRIX_PORT` makes it transparent
- Automation bridge — auto-enabled in dev builds
- `beforeBuildCommand` — kept for production builds

### Usage

```bash
pnpm dev:mac   # One command starts everything
```
