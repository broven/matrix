---
name: test-sync
description: |
  Sync release flow test files with the README spec. Reads tests/release/README.md Test Cases table,
  compares with tests/release/flows/*.test.ts files, then creates/deletes/updates test files to match.
  Triggers: "test-sync", "sync tests", "sync test cases", "同步测试"
user-invocable: true
allowed-tools: Read, Write, Edit, Bash(pnpm *), Bash(rm *), Bash(git *), Glob, Grep, Agent
---

# /test-sync — Sync Release Tests with README

## What this does

Reads `tests/release/README.md` and ensures the test files in `tests/release/flows/` match exactly.

## Process

### 1. Parse README

Read `tests/release/README.md`. Extract the **Test Cases** table rows. Each row has:
- `文件` — file name stem (e.g. `connect-server`)
- `验证内容` — one-sentence description of what to verify

Also check the **Test Case Inbox** section for new cases that haven't been added to the table yet. If found, ask the user whether to move them to the Test Cases table.

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
| CREATE | new-feature.test.ts | New case in README |
| DELETE | old-feature.test.ts | Removed from README |
| OK     | connect-server.test.ts | Matches |
```

### 4. Execute changes — one at a time

For **DELETE**: remove the file.

For **CREATE**: process new test cases **one by one** in the following cycle:

#### Step A — Write slow/debug version
Generate a new test file with generous timeouts and `console.log` diagnostics:
- Import `createBridgeClient`, `setBridge` from lib
- Import UI helpers (`click`, `type`, `waitFor`, `isVisible`, etc.)
- Import flow helpers from `lib/flows/` if applicable
- **`describe` and `it` titles must be in Chinese**, derived from the README `验证内容` column
- Each test must be **self-contained** — set up its own state (repo, worktree, session) in `beforeAll` and clean up in `afterAll`. Tests have NO execution order dependency.
- Use `data-testid` selectors — check the actual components to find the right selectors
- If the test needs new flow helpers, create them in `lib/flows/`
- If components are missing `data-testid`, add them
- Add extra `console.log` at key steps to aid debugging
- Use longer timeouts (e.g. `waitFor(..., { timeout: 10_000 })`)

#### Step B — Run and present for review
Run `pnpm test:release` to execute the new test. Show the user:
- Pass/fail result
- Key console output
- The test file content

**Wait for user review and approval before continuing.**

#### Step C — Optimize and commit
After user approves:
- Remove diagnostic `console.log` statements
- Tighten timeouts to normal values (default 5s or less)
- Run `pnpm test:release` again to confirm it still passes
- Commit just this test case with message: `test: add <filename> release flow test`

Then move to the next CREATE case and repeat from Step A.

For **UPDATE**: if the description changed significantly, review and update the test logic.

### 5. Final verify

After all changes, run `pnpm test:release` one final time to confirm everything passes together.

## Key rules

- README is the source of truth — tests follow it, not the other way around
- **Test titles (`describe`/`it`) must be in Chinese**, closely matching the `验证内容` from README
- **Tests have NO execution order** — each test is fully self-contained with its own setup/teardown
- **File names have NO numeric prefix** — just `<name>.test.ts`
- Always check the actual component DOM for correct `data-testid` selectors before writing tests
- Use the Automation Bridge skill docs for bridge API reference
- The global-setup.ts handles pre/post cleanup — don't duplicate cleanup in individual tests
