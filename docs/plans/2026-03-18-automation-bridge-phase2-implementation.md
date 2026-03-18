# Automation Bridge Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the client automation bridge into core/runtime layers, expose the full phase-2 protocol on macOS, and prepare the same capability model for iOS simulator reuse.

**Architecture:** Keep the bridge inside `packages/client`, split protocol/capability definitions from Tauri runtime wiring, replace the noop webview backend with a request/response bridge, and add the remaining HTTP endpoints with desktop-first adapters and iOS-compatible abstractions.

**Tech Stack:** Tauri 2, Rust, serde/serde_json, React, TypeScript, Vitest, node:test

---

### Task 1: Add failing scaffold tests for the phase-2 automation layout

**Files:**
- Modify: `packages/client/test/tauri-scaffold.test.mjs`
- Create: `packages/client/src-tauri/src/automation/core/mod.rs`
- Create: `packages/client/src-tauri/src/automation/runtime/mod.rs`

**Step 1: Write the failing test**

Extend `packages/client/test/tauri-scaffold.test.mjs` to assert:

- `src-tauri/src/automation/core/mod.rs` exists
- `src-tauri/src/automation/runtime/mod.rs` exists
- `lib.rs` references the new layout instead of a flat automation module

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @matrix/client exec node --test test/tauri-scaffold.test.mjs
```

Expected: FAIL because the split layout does not exist yet.

**Step 3: Write minimal implementation**

Create the empty `core` and `runtime` module entrypoints and wire them into the existing automation module tree.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client exec node --test test/tauri-scaffold.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/test/tauri-scaffold.test.mjs packages/client/src-tauri/src/automation/core/mod.rs packages/client/src-tauri/src/automation/runtime/mod.rs packages/client/src-tauri/src/automation/mod.rs packages/client/src-tauri/src/lib.rs
git commit -m "refactor: scaffold automation core and runtime modules"
```

### Task 2: Add failing Rust protocol model tests

**Files:**
- Create: `packages/client/src-tauri/src/automation/core/models.rs`
- Create: `packages/client/src-tauri/src/automation/core/errors.rs`
- Create: `packages/client/src-tauri/src/automation/core/protocol.rs`
- Test: `packages/client/src-tauri/src/automation/core/protocol.rs`

**Step 1: Write the failing test**

Add unit tests asserting:

- request models deserialize for `webview/event`, `native/invoke`, `test/reset`, and `wait`
- envelope responses serialize with `ok/result/error`
- error helpers emit stable strings like `unsupported_action` and `timeout`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::core::protocol
```

Expected: FAIL because the protocol models do not exist.

**Step 3: Write minimal implementation**

Implement:

- request/response structs
- reset scope enum
- wait condition enum
- shared envelope struct
- error code enum/string mapping

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::core::protocol
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/core/mod.rs packages/client/src-tauri/src/automation/core/models.rs packages/client/src-tauri/src/automation/core/errors.rs packages/client/src-tauri/src/automation/core/protocol.rs
git commit -m "feat: add phase 2 automation protocol models"
```

### Task 3: Add failing Rust capability contract tests

**Files:**
- Create: `packages/client/src-tauri/src/automation/core/capabilities.rs`
- Test: `packages/client/src-tauri/src/automation/core/capabilities.rs`

**Step 1: Write the failing test**

Add contract tests using mock implementations to assert:

- `NativeCapability::invoke()` routes supported actions and rejects unsupported ones
- `WebviewCapability` supports `eval`, `dispatch_event`, and `snapshot`
- `TestControlCapability::reset()` accepts multiple scopes
- `WaitCapability::wait_for()` supports `webview.eval` and `state.match`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::core::capabilities
```

Expected: FAIL because the capability traits and helpers do not exist.

**Step 3: Write minimal implementation**

Define the capability traits and small dispatch helpers backed by mockable interfaces.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::core::capabilities
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/core/capabilities.rs packages/client/src-tauri/src/automation/core/mod.rs
git commit -m "feat: add automation capability contracts"
```

### Task 4: Add failing runtime router tests for the full protocol surface

**Files:**
- Create: `packages/client/src-tauri/src/automation/runtime/router.rs`
- Modify: `packages/client/src-tauri/src/automation/runtime/mod.rs`
- Test: `packages/client/src-tauri/src/automation/runtime/router.rs`

**Step 1: Write the failing test**

Add router tests that start the loopback HTTP server and assert:

- `POST /webview/event` returns `200`
- `POST /native/invoke` returns `200` for supported actions and structured failure for unsupported actions
- `POST /test/reset` returns `200`
- `POST /wait` returns `200` on success and timeout envelope on expiry

Use mock capabilities so the tests do not require a real Tauri window.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::router
```

Expected: FAIL because the new runtime router and endpoints do not exist.

**Step 3: Write minimal implementation**

Move the current HTTP server logic into `runtime/router.rs` and extend it to dispatch through the new capability layer for all phase-2 endpoints.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::router
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/runtime/mod.rs packages/client/src-tauri/src/automation/runtime/router.rs packages/client/src-tauri/src/automation/mod.rs
git commit -m "feat: add phase 2 automation router"
```

### Task 5: Add failing front-end bridge tests for runScript and scoped reset

**Files:**
- Modify: `packages/client/src/__tests__/automation-bridge.test.tsx`
- Modify: `packages/client/src/automation/bridge.ts`
- Modify: `packages/client/src/automation/test-hooks.ts`

**Step 1: Write the failing test**

Extend the front-end automation tests to assert:

- `runScript()` returns JSON-safe values
- thrown exceptions are surfaced as structured errors
- `resetTestState(scope?)` supports scoped reset inputs
- `dispatchEvent()` still works after the bridge expansion

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @matrix/client exec vitest run src/__tests__/automation-bridge.test.tsx
```

Expected: FAIL because the front-end bridge does not yet expose `runScript()` or scoped reset.

**Step 3: Write minimal implementation**

Add:

- `runScript(script: string)`
- structured return shape for script execution
- scoped reset handling in the test hooks

Keep all returned values JSON-safe.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client exec vitest run src/__tests__/automation-bridge.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/__tests__/automation-bridge.test.tsx packages/client/src/automation/bridge.ts packages/client/src/automation/test-hooks.ts packages/client/src/main.tsx
git commit -m "feat: extend frontend automation bridge"
```

### Task 6: Add failing desktop webview-bridge tests

**Files:**
- Create: `packages/client/src-tauri/src/automation/runtime/webview.rs`
- Test: `packages/client/src-tauri/src/automation/runtime/webview.rs`

**Step 1: Write the failing test**

Add tests around a desktop webview bridge abstraction asserting:

- requests can be sent to a mock front-end bridge
- eval returns structured success and error payloads
- event dispatch delegates to the same runtime bridge
- snapshot reads from the front-end bridge

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::webview
```

Expected: FAIL because the runtime webview bridge does not exist.

**Step 3: Write minimal implementation**

Implement a `WebviewBridge` abstraction that the desktop adapter can use to:

- run scripts
- dispatch events
- request snapshots

The first implementation may still use a mocked transport internally, but it must replace `NoopWebviewEvalBackend` in the runtime wiring.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::webview
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/runtime/webview.rs packages/client/src-tauri/src/automation/runtime/mod.rs
git commit -m "feat: add runtime webview bridge"
```

### Task 7: Add failing desktop adapter tests

**Files:**
- Create: `packages/client/src-tauri/src/automation/runtime/desktop.rs`
- Test: `packages/client/src-tauri/src/automation/runtime/desktop.rs`

**Step 1: Write the failing test**

Add tests with mock window/sidecar facades asserting:

- supported native actions invoke the correct facade methods
- `state()` reports desktop window and sidecar metadata
- `reset()` can map scopes to desktop behaviors
- unsupported actions return `unsupported_action`

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::desktop
```

Expected: FAIL because the desktop adapter does not exist.

**Step 3: Write minimal implementation**

Implement the desktop adapter against small facades rather than direct Tauri types, so tests can stay cheap and deterministic.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::desktop
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/runtime/desktop.rs packages/client/src-tauri/src/automation/runtime/mod.rs
git commit -m "feat: add automation desktop adapter"
```

### Task 8: Add failing iOS simulator adapter tests

**Files:**
- Create: `packages/client/src-tauri/src/automation/runtime/ios_sim.rs`
- Test: `packages/client/src-tauri/src/automation/runtime/ios_sim.rs`

**Step 1: Write the failing test**

Add tests asserting:

- shared actions reuse the same capability contracts
- desktop-only actions return `unsupported_action`
- state and reset responses still produce valid envelopes

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::ios_sim
```

Expected: FAIL because the iOS simulator adapter does not exist.

**Step 3: Write minimal implementation**

Implement an `IosSimulatorAdapter` skeleton that satisfies the shared capability contracts and explicitly rejects unsupported desktop-only actions.

**Step 4: Run test to verify it passes**

Run:

```bash
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation::runtime::ios_sim
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/automation/runtime/ios_sim.rs packages/client/src-tauri/src/automation/runtime/mod.rs
git commit -m "feat: add ios simulator automation adapter"
```

### Task 9: Wire the desktop runtime into Tauri startup and remove noop runtime paths

**Files:**
- Modify: `packages/client/src-tauri/src/lib.rs`
- Modify: `packages/client/src-tauri/src/automation/mod.rs`
- Modify: `packages/client/src-tauri/src/automation/state.rs`
- Modify: `packages/client/test/tauri-scaffold.test.mjs`

**Step 1: Write the failing test**

Extend the scaffold test to assert:

- startup wiring references the runtime desktop adapter
- startup no longer uses `NoopWebviewEvalBackend`
- discovery still writes successfully

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @matrix/client exec node --test test/tauri-scaffold.test.mjs
```

Expected: FAIL because the startup path still uses the old runtime wiring.

**Step 3: Write minimal implementation**

Update startup to create:

- shared automation state
- desktop adapter
- runtime router
- discovery metadata

and remove direct dependency on the old noop webview backend path.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client exec node --test test/tauri-scaffold.test.mjs
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src-tauri/src/lib.rs packages/client/src-tauri/src/automation/mod.rs packages/client/src-tauri/src/automation/state.rs packages/client/test/tauri-scaffold.test.mjs
git commit -m "refactor: wire phase 2 automation runtime"
```

### Task 10: Add developer documentation and final smoke verification

**Files:**
- Create: `packages/client/AUTOMATION.md`
- Modify: `scripts/smoke-mac-automation.sh`
- Modify: `package.json`

**Step 1: Write the failing test**

Add or extend a lightweight script/test assertion that checks:

- the smoke script still validates `/health` and `/state`
- documentation references the supported endpoints and discovery path

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm smoke:mac-automation
```

Expected: FAIL if the new runtime contract or docs hooks are missing.

**Step 3: Write minimal implementation**

Add `packages/client/AUTOMATION.md` covering:

- startup conditions
- discovery metadata
- supported endpoints
- desktop vs iOS simulator capability matrix
- troubleshooting

Update the smoke script only as needed to reflect the final runtime behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @matrix/client exec node --test test/tauri-scaffold.test.mjs
pnpm --filter @matrix/client exec vitest run src/__tests__/automation-bridge.test.tsx
cargo test --manifest-path packages/client/src-tauri/Cargo.toml automation
pnpm --filter @matrix/client tauri:dev
pnpm smoke:mac-automation
```

Expected: PASS, with the live dev app exposing the finalized desktop bridge.

**Step 5: Commit**

```bash
git add packages/client/AUTOMATION.md scripts/smoke-mac-automation.sh package.json
git commit -m "docs: add automation bridge usage guide"
```
