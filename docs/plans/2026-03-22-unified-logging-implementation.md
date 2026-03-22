# Unified Logging System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all ad-hoc `console.log`/`eprintln!` logging with a unified, structured logging system that merges client + server logs into a single rotated file.

**Architecture:** Server uses `pino` with JSON output. On Mac, Tauri captures sidecar stdout and forwards to `tauri-plugin-log` (which uses `tracing`). On Linux standalone, `pino-roll` writes directly to `~/.matrix/logs/`. Client uses `@tauri-apps/plugin-log` JS bindings.

**Tech Stack:** `tauri-plugin-log` (Rust), `pino` + `pino-roll` (Bun/Node), `@tauri-apps/plugin-log` (React)

---

### Task 1: Add `pino` and `pino-roll` to Server

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Install dependencies**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log && cd packages/server && bun add pino pino-roll`

**Step 2: Verify installation**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && cat package.json | grep pino`
Expected: Both `pino` and `pino-roll` in dependencies

**Step 3: Commit**

```bash
git add packages/server/package.json packages/server/bun.lock
git commit -m "chore: add pino and pino-roll to server dependencies"
```

---

### Task 2: Create Server Logger Module

**Files:**
- Create: `packages/server/src/logger.ts`

**Step 1: Create the logger module**

```typescript
import pino from "pino";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const isLocal = process.env.MATRIX_LOCAL === "true";
const defaultLevel = process.env.NODE_ENV === "production" ? "info" : "debug";
const level = process.env.MATRIX_LOG_LEVEL || defaultLevel;

function createLogger(): pino.Logger {
  // Sidecar mode: JSON to stdout, Rust captures and forwards to tauri-plugin-log
  if (isLocal) {
    return pino({ level });
  }

  // Standalone mode (Linux): write to ~/.matrix/logs/ via pino-roll
  const logDir = join(homedir(), ".matrix", "logs");
  mkdirSync(logDir, { recursive: true });

  return pino(
    { level },
    pino.transport({
      target: "pino-roll",
      options: {
        file: join(logDir, "matrix.log"),
        size: "10m",
        limit: { count: 5 },
        mkdir: true,
      },
    }),
  );
}

export const logger = createLogger();
```

**Step 2: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && bun build --no-bundle src/logger.ts --outdir /tmp/matrix-logger-check`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/logger.ts
git commit -m "feat: add structured pino logger with sidecar/standalone modes"
```

---

### Task 3: Replace `debugLog` in ACP Bridge with Logger

**Files:**
- Modify: `packages/server/src/acp-bridge/index.ts`

**Step 1: Replace the debugLog function and all console calls**

In `packages/server/src/acp-bridge/index.ts`:

1. Remove the `import { appendFileSync } from "node:fs";` on line 1
2. Remove the `debugLog` function (lines 4-7)
3. Add at top: `import { logger } from "../logger.js";` and create a child: `const log = logger.child({ target: "acp-bridge" });`
4. Replace `debugLog(...)` calls:
   - Line 57: `debugLog(\`stdout chunk...\`)` → `log.debug({ bytes: chunk.length }, "stdout chunk")`
   - Line 182: `debugLog(\`send: ...\`)` → `log.debug({ method: message.method }, "send")`
   - Line 196: `debugLog(\`recv: ...\`)` → `log.debug({ method: msg.method, id: msg.id }, "recv")`
5. Replace line 63: `console.error(\`[agent stderr] ...\`)` → `log.warn({ output: data.toString().trim() }, "agent stderr")`

**Step 2: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && bun build --no-bundle src/acp-bridge/index.ts --outdir /tmp/matrix-bridge-check`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/acp-bridge/index.ts
git commit -m "refactor: replace debugLog with pino logger in acp-bridge"
```

---

### Task 4: Replace Console Logging in Server Index

**Files:**
- Modify: `packages/server/src/index.ts`

**Step 1: Add logger import and child loggers**

Add near top of `packages/server/src/index.ts` (after other imports):
```typescript
import { logger } from "./logger.js";
const log = logger.child({ target: "server" });
```

**Step 2: Replace all console.log/error calls in index.ts**

| Line | Old | New |
|------|-----|-----|
| 98 | `console.log(\`[session ${sessionId}] handlePrompt:...\`)` | `log.info({ sessionId, prompt: JSON.stringify(prompt).slice(0, 200) }, "handlePrompt")` |
| 243 | `console.log(\`[session ${sessionId}] update: ...\`)` | `log.debug({ sessionId, update: update.sessionUpdate }, "session update")` |
| 284 | `console.log(\`[session ${sessionId}] permission_request:...\`)` | `log.info({ sessionId }, "permission_request")` |
| 301 | `console.error(\`[session ${sessionId}] Agent error:...\`)` | `log.error({ sessionId, err: error }, "agent error")` |
| 309 | `console.log(\`[session ${sessionId}] Agent process closed\`)` | `log.info({ sessionId }, "agent process closed")` |
| 540 | `console.log(\`  Serving web UI from ...\`)` | `log.info({ webDir: resolvedWebDir }, "serving web UI")` |
| 563 | `console.log(\`\\n  Matrix Server running...\`)` | `log.info({ host: config.host, port: config.port }, "Matrix Server started")` |
| 564 | `console.log(\`\\n  Auth token: ...\`)` | `log.info({ token: serverToken }, "auth token")` |
| 567 | `console.log(\`\\n  Connect URI: ...\`)` | `log.info({ uri: connectionUri }, "connect URI")` |
| 568-569 | `console.log("\\n  Scan QR:"); qrcode.generate(...)` | Keep as-is (QR code needs stdout) |
| 570 | `console.log(\`\\n  Discovered agents:...\`)` | `log.info({ agents: discoveredAgents.map(a => a.name) }, "discovered agents")` |

**Step 3: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && bun build --no-bundle src/index.ts --outdir /tmp/matrix-index-check`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "refactor: replace console.log with pino logger in server index"
```

---

### Task 5: Replace Console Logging in Remaining Server Files

**Files:**
- Modify: `packages/server/src/session-manager/index.ts`
- Modify: `packages/server/src/agent-manager/discovery.ts`
- Modify: `packages/server/src/worktree-manager/index.ts`
- Modify: `packages/server/src/clone-manager/index.ts`
- Modify: `packages/server/src/data-dir.ts`
- Modify: `packages/server/src/bridge/index.ts`
- Modify: `packages/server/src/api/rest/repositories.ts`

**Step 1: Add logger imports to each file**

Each file should import and create a child logger:
```typescript
import { logger } from "../logger.js";  // adjust path as needed
const log = logger.child({ target: "<module-name>" });
```

**Step 2: Replace all console.log/error/warn calls**

For each file, replace `console.log(...)` with `log.info(...)`, `console.error(...)` with `log.error(...)`, `console.warn(...)` with `log.warn(...)`.

Specific replacements:

**`session-manager/index.ts`** (target: `session-manager`):
- Line 105: `console.log(...)` → `log.info({ sessionId }, "...")`
- Line 122: `console.log(...)` → `log.info({ sessionId }, "...")`
- Line 148: `console.error(...)` → `log.error({ sessionId }, "no bridge factory")`
- Line 159: `console.log(...)` → `log.info({ sessionId }, "agent restarted")`
- Line 161: `console.error(...)` → `log.error({ sessionId, err }, "restart failed")`

**`agent-manager/discovery.ts`** (target: `discovery`):
- Line 46: `console.warn(...)` → `log.warn({ status: response.status }, "registry fetch failed")`
- Line 51: `console.warn(...)` → `log.warn("invalid registry shape")`
- Line 56: `console.warn(...)` → `log.warn({ err: error }, "registry fetch failed")`
- Line 82: `console.warn(...)` → `log.warn("npx not found, using fallback agents")`
- Line 90: `console.warn(...)` → `log.warn({ err: error }, "registry discovery failed")`
- Line 122: `console.log(...)` → `log.info({ agents: ... }, "discovered agents")`
- Line 128: `console.warn(...)` → `log.warn("no agents discovered, using fallback")`

**`worktree-manager/index.ts`** (target: `worktree`):
- Line 246: `console.error(...)` → `log.error({ exitCode, stderr }, "wt remove failed")`
- Line 278: `console.error(...)` → `log.error({ exitCode, stderr }, "git worktree remove failed")`
- Line 285: `console.warn(...)` → `log.warn({ stderr }, "branch deletion failed")`

**`clone-manager/index.ts`** (target: `clone`):
- Line 101: `console.error(...)` → `log.error({ err: e }, "onComplete callback failed")`
- Line 118: `console.error(...)` → `log.error({ err: e }, "onComplete callback failed")`

**`data-dir.ts`** (target: `data-dir`):
- Lines 37, 40, 44: Replace all `console.error(...)` with `log.error(...)` equivalents

**`bridge/index.ts`** (target: `bridge`):
- Line 47: `console.log(...)` → `log.info({ clientId }, "client registered")`
- Line 64: `console.log(...)` → `log.info({ clientId }, "client registered")`
- Line 84: `console.log(...)` → `log.info({ clientId }, "client disconnected")`

**`api/rest/repositories.ts`** (target: `repositories`):
- Line 90: `console.error(...)` → `log.error({ branch: wt.branch, err: error }, "failed to remove worktree")`
- Line 121: `console.log(...)` → `log.info({ path: resolved }, "deleted source files")`
- Line 123: `console.error(...)` → `log.error({ path: resolved, err: error }, "failed to delete source files")`
- Line 195: `console.error(...)` → `log.error({ message }, "worktree creation failed")`
- Line 267: `console.error(...)` → `log.error({ message }, "git removal failed")`
- Line 399: `console.error(...)` → `log.error({ err }, "failed to auto-register repository")`

**Step 3: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && bun build --no-bundle src/index.ts --outdir /tmp/matrix-all-check`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/session-manager/index.ts packages/server/src/agent-manager/discovery.ts packages/server/src/worktree-manager/index.ts packages/server/src/clone-manager/index.ts packages/server/src/data-dir.ts packages/server/src/bridge/index.ts packages/server/src/api/rest/repositories.ts
git commit -m "refactor: replace all console.log/error/warn with pino logger across server"
```

---

### Task 6: Add `tauri-plugin-log` to Rust/Tauri

**Files:**
- Modify: `packages/client/src-tauri/Cargo.toml`
- Modify: `packages/client/src-tauri/src/lib.rs`
- Modify: `packages/client/src-tauri/capabilities/default.json`

**Step 1: Add dependency to Cargo.toml**

Add to `[dependencies]` section in `packages/client/src-tauri/Cargo.toml`:
```toml
tauri-plugin-log = { version = "2", features = ["colored"] }
log = "0.4"
```

**Step 2: Register plugin in lib.rs**

In `packages/client/src-tauri/src/lib.rs`, at the top add:
```rust
use tauri_plugin_log::{Target, TargetKind};
```

In the `run()` function (line 89), add the plugin registration after the builder creation:

```rust
let builder = tauri::Builder::default()
    .plugin(
        tauri_plugin_log::Builder::new()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: None }),
                Target::new(TargetKind::Webview),
            ])
            .level(if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            })
            .max_file_size(10_000_000) // 10MB per file
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
            .build(),
    )
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .manage(MockFileDialogState(std::sync::Mutex::new(None)));
```

**Step 3: Replace `eprintln!` with `log::info!`/`log::warn!` macros**

Replace all `eprintln!("[matrix-client] ...")` and `eprintln!("[matrix-server] ...")` calls with appropriate `log::` macros:

- Line 149: `eprintln!("[matrix-client] SKIP_SIDECAR=true...")` → `log::info!("SKIP_SIDECAR=true, skipping sidecar spawn (using external dev server on port {sidecar_port})");`
- Lines 166-168: `eprintln!("[matrix-client] killing orphaned...")` → `log::warn!("killing orphaned process on port {}: pid {}", sidecar_port, pid_str);`
- Line 206: `eprintln!("[matrix-server] {}")` → `log::info!(target: "sidecar", "{}", String::from_utf8_lossy(&line));`
- Line 209: `eprintln!("[matrix-server:err] {}")` → `log::warn!(target: "sidecar", "{}", String::from_utf8_lossy(&line));`
- Lines 212-215: `eprintln!("[matrix-server] terminated...")` → `log::info!(target: "sidecar", "terminated code={:?} signal={:?}", payload.code, payload.signal);`

**Step 4: Parse sidecar JSON and forward to tracing**

In the sidecar output handler (lines 201-221), for stdout lines, try to parse the line as JSON from pino. If it parses successfully, extract the level and message and log with the appropriate level. If not JSON, log as-is.

Replace the stdout handler (line 205-207):
```rust
CommandEvent::Stdout(line) => {
    let text = String::from_utf8_lossy(&line);
    // Try to parse pino JSON and forward at correct level
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
        let msg = parsed.get("msg").and_then(|v| v.as_str()).unwrap_or("");
        match parsed.get("level").and_then(|v| v.as_u64()) {
            Some(10) => log::trace!(target: "sidecar", "{}", msg),
            Some(20) => log::debug!(target: "sidecar", "{}", msg),
            Some(30) => log::info!(target: "sidecar", "{}", msg),
            Some(40) => log::warn!(target: "sidecar", "{}", msg),
            Some(50) | Some(60) => log::error!(target: "sidecar", "{}", msg),
            _ => log::info!(target: "sidecar", "{}", text),
        }
    } else {
        log::info!(target: "sidecar", "{}", text);
    }
}
```

**Step 5: Add `log:default` permission to capabilities**

In `packages/client/src-tauri/capabilities/default.json`, add `"log:default"` to the permissions array.

**Step 6: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/client/src-tauri && cargo check`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/client/src-tauri/Cargo.toml packages/client/src-tauri/src/lib.rs packages/client/src-tauri/capabilities/default.json
git commit -m "feat: add tauri-plugin-log with rotation, replace eprintln with log macros"
```

---

### Task 7: Add `@tauri-apps/plugin-log` to Client and Create Logger

**Files:**
- Modify: `packages/client/package.json`
- Create: `packages/client/src/lib/logger.ts`
- Modify: `packages/client/src/main.tsx`

**Step 1: Install the package**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/client && bun add @tauri-apps/plugin-log`

**Step 2: Create client logger module**

Create `packages/client/src/lib/logger.ts`:

```typescript
import { info, error, warn, debug, trace } from "@tauri-apps/plugin-log";

export const logger = {
  trace: (msg: string) => {
    trace(msg);
    if (import.meta.env.DEV) console.debug(`[trace] ${msg}`);
  },
  debug: (msg: string) => {
    debug(msg);
    if (import.meta.env.DEV) console.debug(msg);
  },
  info: (msg: string) => {
    info(msg);
    if (import.meta.env.DEV) console.info(msg);
  },
  warn: (msg: string) => {
    warn(msg);
    if (import.meta.env.DEV) console.warn(msg);
  },
  error: (msg: string) => {
    error(msg);
    if (import.meta.env.DEV) console.error(msg);
  },
};
```

**Step 3: Replace console calls in main.tsx**

In `packages/client/src/main.tsx`:
- Add import: `import { logger } from "./lib/logger";`
- Line 42: `console.warn("[bridge-ws] Could not fetch auth-info...")` → `logger.warn("[bridge-ws] Could not fetch auth-info, skipping bridge WebSocket")`
- Line 50: `console.error("[bridge-ws] Failed to connect:", err)` → `logger.error(\`[bridge-ws] Failed to connect: ${err}\`)`

**Step 4: Verify it compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/client/package.json packages/client/src/lib/logger.ts packages/client/src/main.tsx
git commit -m "feat: add client logger using tauri-plugin-log with dev console fallback"
```

---

### Task 8: Verify End-to-End

**Step 1: Build the full project**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log && bun run --filter "@matrix/server" build`
Expected: No type errors

**Step 2: Run existing server tests**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/server && bun test`
Expected: All tests pass

**Step 3: Run client type check**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/client && npx tsc --noEmit`
Expected: No type errors

**Step 4: Verify Rust compiles**

Run: `cd /Users/metajs/.superset/worktrees/matrix/log/packages/client/src-tauri && cargo check`
Expected: No errors

**Step 5: Commit any fixes if needed**

If any tests or type checks fail, fix them and commit.
