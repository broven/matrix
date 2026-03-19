# Mac Automation Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dev-only automation bridge for the macOS Tauri app so AI and scripts can discover the running app, read state, and drive both WebView and native shell behavior without relying on CDP.

**Architecture:** Add a Rust-hosted HTTP bridge inside the Tauri app, guarded behind dev-only flags and loopback-only binding. Expose a small set of structured endpoints, add a front-end automation shim on `window.__MATRIX_AUTOMATION__`, and verify the flow end to end against the running dev app.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Vite, Bun, Playwright, serde/serde_json, local HTTP server in Rust

---

### Task 1: Add a failing Rust automation-state test

**Files:**
- Create: `packages/client/src-tauri/src/automation/state.rs`
- Create: `packages/client/src-tauri/src/automation/mod.rs`
- Test: `packages/client/src-tauri/src/automation/state.rs`

**Step 1: Write the failing test**

Add a unit test in `packages/client/src-tauri/src/automation/state.rs` that constructs an automation state object and asserts:

- token is non-empty
- platform string is set
- default readiness flags are false
- `base_url()` returns `http://127.0.0.1:<port>`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::state
```

Expected: FAIL because the automation module and state type do not exist yet.

**Step 3: Write minimal implementation**

Implement:

- `AutomationState`
- token generation helper
- default readiness fields
- `base_url()` helper
- module export in `mod.rs`

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::state
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/mod.rs packages/client/src-tauri/src/automation/state.rs
git commit -m "feat: add automation bridge state"
```

### Task 2: Add a failing Rust discovery-file test

**Files:**
- Modify: `packages/client/src-tauri/src/automation/state.rs`
- Test: `packages/client/src-tauri/src/automation/state.rs`

**Step 1: Write the failing test**

Add a unit test that writes discovery metadata to a temp directory and asserts the generated JSON includes:

- `enabled`
- `platform`
- `baseUrl`
- `token`
- `pid`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::state::tests::writes_discovery_file
```

Expected: FAIL because the write helper does not exist.

**Step 3: Write minimal implementation**

Implement a helper that serializes discovery metadata and writes `automation.json` to an app-support path or injected temp directory.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::state::tests::writes_discovery_file
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/state.rs
git commit -m "feat: write automation discovery metadata"
```

### Task 3: Add a failing Rust health/state endpoint test

**Files:**
- Create: `packages/client/src-tauri/src/automation/server.rs`
- Modify: `packages/client/src-tauri/src/automation/mod.rs`
- Test: `packages/client/src-tauri/src/automation/server.rs`

**Step 1: Write the failing test**

Add tests that start the automation HTTP router in-process and assert:

- `GET /health` returns `200`
- response JSON contains `ok`, `platform`, `appReady`, `webviewReady`, `sidecarReady`
- `GET /state` returns `200`
- response JSON contains `window`, `webview`, `sidecar`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::server
```

Expected: FAIL because the HTTP server/router does not exist yet.

**Step 3: Write minimal implementation**

Implement a small loopback-only HTTP server that:

- binds to `127.0.0.1`
- checks bearer token
- supports `GET /health`
- supports `GET /state`

Keep the response model minimal and serialized via `serde`.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::server
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/mod.rs packages/client/src-tauri/src/automation/server.rs
git commit -m "feat: add automation health and state endpoints"
```

### Task 4: Add a failing front-end automation-shim test

**Files:**
- Create: `packages/client/src/automation/bridge.ts`
- Create: `packages/client/src/automation/test-hooks.ts`
- Test: `packages/client/src/__tests__/automation-bridge.test.tsx`

**Step 1: Write the failing test**

Add a front-end test that mounts the app or a small harness and asserts:

- `window.__MATRIX_AUTOMATION__` exists in dev/test mode
- `getSnapshot()` returns a JSON-safe object
- `resetTestState()` clears seeded test values
- `dispatchEvent()` triggers a registered listener

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @matrix/client test -- --run src/__tests__/automation-bridge.test.tsx
```

Expected: FAIL because the automation shim does not exist.

**Step 3: Write minimal implementation**

Implement:

- front-end bridge installer
- `getSnapshot()`
- `resetTestState()`
- `dispatchEvent()`

Install the shim only in development/test environments.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client test -- --run src/__tests__/automation-bridge.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/automation/bridge.ts packages/client/src/automation/test-hooks.ts packages/client/src/__tests__/automation-bridge.test.tsx
git commit -m "feat: add front-end automation shim"
```

### Task 5: Add a failing Rust webview-eval contract test

**Files:**
- Modify: `packages/client/src-tauri/src/automation/server.rs`
- Create: `packages/client/src-tauri/src/automation/actions.rs`
- Test: `packages/client/src-tauri/src/automation/server.rs`

**Step 1: Write the failing test**

Add a test for `POST /webview/eval` that verifies:

- unauthorized requests return `401`
- valid requests with JSON `{ "script": "..." }` are accepted
- server returns a structured JSON envelope with `ok`, `result`, and `error`

Mock the evaluation backend so the test does not need a real window.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::server::tests::webview_eval_contract
```

Expected: FAIL because the route and action handler do not exist.

**Step 3: Write minimal implementation**

Implement:

- `POST /webview/eval`
- request/response structs
- action abstraction for webview evaluation
- mockable backend for tests

If Tauri cannot synchronously return eval results, implement an async request/response bridge via front-end automation hooks instead of forcing direct eval return values.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::server::tests::webview_eval_contract
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/server.rs packages/client/src-tauri/src/automation/actions.rs
git commit -m "feat: add automation webview eval endpoint"
```

### Task 6: Wire the bridge into Tauri app startup

**Files:**
- Modify: `packages/client/src-tauri/src/lib.rs`
- Modify: `packages/client/src-tauri/src/automation/mod.rs`
- Test: `packages/client/test/tauri-scaffold.test.mjs`

**Step 1: Write the failing test**

Extend `packages/client/test/tauri-scaffold.test.mjs` to assert the Tauri app supports development automation configuration by checking for an automation module import or environment-controlled startup hook in `lib.rs`.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @matrix/client test -- --run test/tauri-scaffold.test.mjs
```

Expected: FAIL because `lib.rs` does not reference the automation startup path.

**Step 3: Write minimal implementation**

Update `lib.rs` to:

- create and manage `AutomationState`
- start the bridge only in dev/test mode
- register main window and sidecar state
- write discovery metadata after startup

Do not change production behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client test -- --run test/tauri-scaffold.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/lib.rs packages/client/test/tauri-scaffold.test.mjs
git commit -m "feat: start automation bridge in dev builds"
```

### Task 7: Add native action coverage

**Files:**
- Modify: `packages/client/src-tauri/src/automation/actions.rs`
- Modify: `packages/client/src-tauri/src/automation/server.rs`
- Test: `packages/client/src-tauri/src/automation/actions.rs`

**Step 1: Write the failing test**

Add action tests that verify the dispatcher recognizes:

- `window.focus`
- `window.reload`
- `sidecar.status`

Use mocks/stubs for the window and sidecar handles.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::actions
```

Expected: FAIL because the action dispatcher is incomplete.

**Step 3: Write minimal implementation**

Implement the action dispatcher with a strict whitelist and structured JSON responses.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::actions
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/actions.rs packages/client/src-tauri/src/automation/server.rs
git commit -m "feat: add automation native action whitelist"
```

### Task 8: Add a manual end-to-end smoke script

**Files:**
- Create: `scripts/smoke-mac-automation.sh`
- Modify: `package.json`

**Step 1: Write the failing script**

Create a shell script that:

- waits for `automation.json`
- reads `baseUrl` and `token`
- calls `/health`
- calls `/state`
- exits non-zero if bridge is unavailable

Add a root script entry:

```json
"smoke:mac-automation": "bash scripts/smoke-mac-automation.sh"
```

**Step 2: Run script to verify it fails**

Run:

```bash
pnpm smoke:mac-automation
```

Expected: FAIL before the dev app is running or before discovery metadata exists.

**Step 3: Write minimal implementation**

Complete the script using `jq` and `curl`, then document the expected prerequisites in comments.

**Step 4: Run smoke script to verify it passes**

Start the app:

```bash
pnpm --filter @matrix/client tauri:dev
```

In another shell run:

```bash
pnpm smoke:mac-automation
```

Expected: PASS with healthy JSON from `/health` and `/state`

**Step 5: Commit**

```bash
git add scripts/smoke-mac-automation.sh package.json
git commit -m "test: add mac automation smoke script"
```

### Task 9: Verify the complete Phase 1 flow

**Files:**
- Modify: `docs/plans/2026-03-17-mac-automation-bridge-design.md`
- Modify: `docs/plans/2026-03-17-mac-automation-bridge-implementation.md`

**Step 1: Run all targeted tests**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation
pnpm --filter @matrix/client test -- --run src/__tests__/automation-bridge.test.tsx
pnpm --filter @matrix/client test -- --run test/tauri-scaffold.test.mjs
```

Expected: PASS

**Step 2: Run the manual smoke flow**

Run:

```bash
pnpm --filter @matrix/client tauri:dev
pnpm smoke:mac-automation
```

Expected: PASS, with discovery metadata written and bridge endpoints responding.

**Step 3: Update docs if implementation details changed**

If the actual Tauri eval mechanism or discovery path differs from the design, update both plan docs immediately.

**Step 4: Commit**

```bash
git add docs/plans/2026-03-17-mac-automation-bridge-design.md docs/plans/2026-03-17-mac-automation-bridge-implementation.md
git commit -m "docs: finalize automation bridge plan"
```
