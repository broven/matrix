# Pre-Release Flow Tests Design

## Goal

Create a suite of E2E flow tests that must pass before every release. These tests verify the product's core user journeys by driving the real Tauri application through the Automation Bridge.

## Approach

- **Test runner**: Vitest (not Playwright — UI interaction goes through bridge HTTP API)
- **UI driver**: Automation Bridge + custom UI interaction layer (`click`, `type`, `waitFor`)
- **Agent strategy**: Mock agent by default; `@real-agent` tagged tests opt-in to real Claude Code
- **Location**: `tests/e2e/mac/` at project root
- **Trigger**: `pnpm test:e2e:mac` locally; GitHub Actions on tag push

## Architecture

```
tests/e2e/mac/
├── lib/
│   ├── bridge-client.ts       # Automation Bridge HTTP client
│   ├── ui.ts                  # UI primitives (click, type, waitFor, getText, etc.)
│   ├── assertions.ts          # Assertion helpers (expectVisible, expectText)
│   └── flows/                 # Per-feature flow helpers
│       ├── connect.ts
│       ├── repository.ts
│       └── session.ts
├── flows/
│   ├── 01-connect-server.test.ts
│   ├── 02-add-repo-open-local.test.ts
│   ├── 03-add-repo-clone-url.test.ts
│   ├── 04-create-session.test.ts
│   ├── 05-send-prompt.test.ts          # @real-agent
│   ├── 06-session-recovery.test.ts
│   └── 07-delete-repository.test.ts
├── fixtures/
│   └── mock-agent/            # Minimal ACP mock agent
├── scripts/
│   └── wait-for-bridge.mjs   # CI helper: poll until bridge ready
├── setup.ts                   # Global setup: discover bridge, health check, reset
└── vitest.config.ts
```

## Bridge Client (`lib/bridge-client.ts`)

Wraps all Automation Bridge HTTP endpoints:

```ts
const bridge = await createBridgeClient()

bridge.health()                    // GET /health
bridge.state()                     // GET /state
bridge.eval(script)                // POST /webview/eval
bridge.event(name, payload)        // POST /webview/event
bridge.invoke(action)              // POST /native/invoke
bridge.reset(scopes)               // POST /test/reset
bridge.wait(condition)             // POST /wait
bridge.mockFileDialog(path)        // POST /test/mock-file-dialog (new)
```

Auto-discovers `baseUrl` and `token` from `~/Library/Application Support/Matrix/dev/automation.json`.

## UI Interaction Layer (`lib/ui.ts`)

All operations implemented via `bridge.eval()` executing DOM operations:

```ts
await click('[data-testid="add-repo-btn"]')
await type('[data-testid="repo-url"]', 'https://...')
await waitFor('[data-testid="repo-item"]')
await waitForGone('.loading-spinner')
const text = await getText('[data-testid="repo-name"]')
const exists = await isVisible('[data-testid="error-msg"]')
```

Selector strategy: `data-testid` attributes throughout. Stable anchors that don't change with styling or copy.

## Core Test Flows

### 01 — Connect to Server

Verify app starts, sidecar is running, UI shows connected status.

### 02 — Add Repository (Open Local)

Create temp git repo → click Add → Open Local → enter path → confirm → repo appears in sidebar.

Uses `POST /test/mock-file-dialog` to mock native file picker.

### 03 — Add Repository (Clone from URL)

Click Add → Clone from URL → enter git URL → submit → repo appears with cloning status → clone completes.

### 04 — Create Session

Select repo → click New Session → chat interface appears with input ready.

### 05 — Send Prompt & Receive Response (`@real-agent`)

Type prompt → send → wait for assistant response → verify content. This is the only test requiring a real agent.

### 06 — Session Recovery

Record message count → `window.reload` → wait for recovery → verify messages preserved.

### 07 — Delete Repository

Open repo menu → delete → confirm → repo disappears from sidebar.

## Changes Required

### 1. Add `data-testid` to components

| Component | testids |
|-----------|---------|
| Sidebar | `add-repo-btn`, `repo-item-{name}`, `repo-menu`, `new-session-btn` |
| OpenProjectDialog | `open-local-option`, `path-input`, `confirm-btn` |
| CloneFromUrlDialog | `clone-url-option`, `clone-url-input`, `clone-submit-btn` |
| SessionView | `chat-input`, `send-btn`, `assistant-message`, `message-item` |
| ConnectPage | `connection-status-connected` |
| Delete confirm | `delete-repo-option`, `confirm-delete-btn` |

### 2. Extend Automation Bridge

New endpoint: `POST /test/mock-file-dialog`

```json
{ "path": "/tmp/test-repo" }
```

Sets a flag in Rust so next `dialog.open()` returns the mock path instead of showing the native picker.

### 3. Mock Agent

Minimal ACP-compatible process for non-real-agent tests:
- Accept session creation
- Receive prompt → return fixed response
- Reuse patterns from `packages/server/src/__tests__/` mock ACP processes

## Running

```bash
# Local: start app first, then run tests
pnpm --filter @matrix/client tauri:dev
pnpm test:e2e:mac

# With real agent tests
pnpm test:e2e:mac:real-agent

# Single flow
pnpm test:e2e:mac --filter "add-repo-clone"
```

## CI (GitHub Actions)

```yaml
name: Release Tests
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  release-tests:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm --filter @matrix/client tauri:dev &
      - run: pnpm test:e2e:mac:wait-for-bridge
      - run: pnpm test:e2e:mac
```

Notes:
- `macos-latest` has GUI environment — Tauri app can start
- CI only runs mock-agent tests; `@real-agent` skipped
- `wait-for-bridge` polls `automation.json` + health check

## package.json scripts

```json
{
  "test:e2e:mac": "vitest run --config tests/e2e/mac/vitest.config.ts",
  "test:e2e:mac:real-agent": "REAL_AGENT=1 vitest run --config tests/e2e/mac/vitest.config.ts",
  "test:e2e:mac:wait-for-bridge": "node tests/e2e/mac/scripts/wait-for-bridge.mjs"
}
```
