# Test Infrastructure P0 + P1 Design

## Decisions

| Item | Decision |
|------|----------|
| CI trigger | PR + push to main |
| CI scope | server + sdk + client unit tests (no release flow E2E) |
| Coverage tool | Native per runner: Vitest v8 (sdk/client), Bun coverage (server) |
| Frontend test scope | PromptInput + Sidebar |

---

## 1. CI Test Gate (P0)

New workflow: `.github/workflows/test.yml`

**Triggers:**
```yaml
on:
  pull_request:
  push:
    branches: [main]
```

**Three parallel jobs:**

### test-server
- Runner: `ubuntu-latest`
- Setup: Bun
- Command: `cd packages/server && bun test`

### test-sdk
- Runner: `ubuntu-latest`
- Setup: Node 22 + pnpm
- Pre-step: `pnpm install && pnpm -r build` (sdk depends on protocol)
- Command: `cd packages/sdk && pnpm vitest run`

### test-client
- Runner: `ubuntu-latest`
- Setup: Node 22 + pnpm
- Pre-step: `pnpm install && pnpm -r build` (client depends on sdk + protocol)
- Command: `cd packages/client && pnpm vitest run`

**Branch protection:** Require all three status checks to pass before merge.

---

## 2. Coverage Baseline (P1)

### Vitest (sdk + client)
- Add `coverage.provider: 'v8'` and `coverage.reporter: ['text', 'lcov']` to vitest configs
- CI command: `vitest run --coverage`
- Output: text summary in CI log + `coverage/lcov.info` artifact

### Bun (server)
- CI command: `bun test --coverage`
- Output: text summary in CI log

No threshold enforcement initially — establish baseline first.

---

## 3. Frontend Component Tests (P1)

### PromptInput.test.tsx
- Render: input visible, correct placeholder
- Input behavior: typing updates state, Enter sends, Shift+Enter newline
- Slash command: `/` triggers autocomplete list, selection fills input
- Guard: empty input does not send

### Sidebar.test.tsx
- Render: repo list, session list display
- Interaction: click repo switches active, click session switches active
- Session delete button visibility
- Empty state rendering

---

## Out of Scope
- Release flow E2E in CI (requires Tauri build, too heavy)
- Server migration from Bun to Vitest (P2)
- Coverage thresholds (establish baseline first)
- AppLayout / NewWorktreeDialog tests (lower ROI)
