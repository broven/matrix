---
name: test-sync
description: |
  Sync release flow test files with the README spec. Reads tests/release/README.md Test Cases table,
  compares with tests/release/flows/*.test.ts files, then creates/deletes/updates test files to match.
  Triggers: "test-sync", "sync tests", "sync test cases", "同步测试"
user-invocable: true
allowed-tools: Read, Write, Edit, Bash(pnpm *), Bash(rm *), Glob, Grep, Agent
---

# /test-sync — Sync Release Tests with README

## What this does

Reads `tests/release/README.md` and ensures the test files in `tests/release/flows/` match exactly.

## Process

### 1. Parse README

Read `tests/release/README.md`. Extract the **Test Cases** table rows. Each row has:
- `#` — test number (e.g. `01`, `02`)
- `文件` — file name stem (e.g. `connect-server`)
- `验证内容` — one-sentence description of what to verify

Also check the **Test Case Inbox** section for new cases that haven't been numbered yet. If found, ask the user whether to assign numbers and move them to the Test Cases table.

### 2. Diff against existing files

List all `tests/release/flows/*.test.ts` files. Compare with README:
- **In README but no file** → needs to be created
- **File exists but not in README** → needs to be deleted
- **Both exist** → check if the test description still matches the `验证内容`; update if needed

### 3. Report the diff

Print a summary table:
```
| Action | File | Reason |
|--------|------|--------|
| CREATE | 05-new-feature.test.ts | New case in README |
| DELETE | 07-old-feature.test.ts | Removed from README |
| OK     | 01-connect-server.test.ts | Matches |
```

### 4. Execute changes

For **DELETE**: remove the file.

For **CREATE**: generate a new test file following the patterns in existing tests:
- Import `createBridgeClient`, `setBridge` from lib
- Import UI helpers (`click`, `type`, `waitFor`, `isVisible`, etc.)
- Import flow helpers from `lib/flows/` if applicable
- `describe("## — Description")` with `beforeAll` creating bridge
- Test implementation based on `验证内容`
- Use `data-testid` selectors — check the actual components to find the right selectors
- If the test needs new flow helpers, create them in `lib/flows/`
- If components are missing `data-testid`, add them

For **UPDATE**: if the description changed significantly, review and update the test logic.

### 5. Verify

Run `pnpm test:release` to confirm all tests pass. If tests fail, debug and fix.

## Key rules

- README is the source of truth — tests follow it, not the other way around
- Always check the actual component DOM for correct `data-testid` selectors before writing tests
- Use the Automation Bridge skill docs for bridge API reference
- Tests run sequentially (01, 02, 03...) and later tests may depend on state from earlier ones
- The global-setup.ts handles pre/post cleanup — don't duplicate cleanup in individual tests
