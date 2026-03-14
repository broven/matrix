# Session Lifecycle Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add recoverable session suspension, restart-safe session lifecycle persistence, and lazy restore-on-prompt behavior without leaving the client stuck in loading state.

**Architecture:** Extend persisted session metadata so the database becomes the source of truth for session lifecycle, while `SessionManager` remains the in-memory registry for only live bridges. Add ACP session loading support, normalize session state on restart, suspend recoverable idle sessions after 30 minutes, and make prompt handling restore suspended sessions before forwarding user input.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vitest, React, existing Matrix protocol and SDK transport layers

---

### Task 1: Expand persisted session schema

**Files:**
- Modify: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/store.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:

- newly created sessions persist `status`, `recoverable`, `agentSessionId`, `lastActiveAt`, `suspendedAt`, and `closeReason`
- existing databases migrate to include the new `sessions` columns
- store methods can update lifecycle state without deleting history

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/store.test.ts`
Expected: FAIL because `Store` does not expose or persist the new fields yet.

**Step 3: Write minimal implementation**

Update `Store` to:

- migrate `sessions` with the new lifecycle columns
- return the expanded session info shape from `createSession()` and `listSessions()`
- add explicit methods to:
  - fetch one session by ID
  - update lifecycle state
  - touch `last_active_at`
  - normalize restart state

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/store/index.ts packages/server/src/__tests__/store.test.ts
git commit -m "feat: persist session lifecycle metadata"
```

### Task 2: Extend protocol session types for lifecycle status

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/transport.ts`
- Test: `packages/sdk/src/__tests__/client.test.ts`

**Step 1: Write the failing tests**

Add or update SDK-facing tests to assert session info and server messages can represent:

- `active`
- `suspended`
- `restoring`
- `closed`

and optional lifecycle reasons where needed.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/client.test.ts`
Expected: FAIL because the protocol types do not include the new lifecycle states or messages.

**Step 3: Write minimal implementation**

Update protocol definitions to add:

- expanded session status union
- lifecycle-aware transport messages such as `session:suspended` and `session:restoring`, or enrich existing messages with reasons

Keep the protocol additive and narrow to what the client actually needs.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/transport.ts packages/sdk/src/__tests__/client.test.ts
git commit -m "feat: add session lifecycle protocol states"
```

### Task 3: Add ACP load-session support to the bridge

**Files:**
- Modify: `packages/server/src/acp-bridge/index.ts`
- Test: `packages/server/src/__tests__/acp-bridge.test.ts`
- Test: `packages/server/src/__tests__/acp-bridge-timeout.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:

- `initialize()` exposes capabilities needed to detect `loadSession`
- `createSession()` captures the agent-native session ID
- a new `loadSession()` path reuses a stored agent session ID
- load failure rejects cleanly

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/acp-bridge.test.ts src/__tests__/acp-bridge-timeout.test.ts`
Expected: FAIL because the bridge cannot load an existing session yet.

**Step 3: Write minimal implementation**

Update `AcpBridge` to:

- store initialize result or expose capability data
- add a `loadSession(agentSessionId, cwd)` method
- ensure prompt routing continues to use the agent-native session ID after restore

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/acp-bridge.test.ts src/__tests__/acp-bridge-timeout.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/acp-bridge/index.ts packages/server/src/__tests__/acp-bridge.test.ts packages/server/src/__tests__/acp-bridge-timeout.test.ts
git commit -m "feat: support loading existing acp sessions"
```

### Task 4: Persist recoverability and restore metadata during session creation

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/e2e.test.ts`

**Step 1: Write the failing tests**

Add an end-to-end test that creates a session and verifies the persisted row contains:

- `recoverable`
- `agent_session_id`
- `last_active_at`
- `status = active`

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts`
Expected: FAIL because create-session currently only stores basic session metadata.

**Step 3: Write minimal implementation**

During session creation:

- inspect ACP capabilities after initialize
- derive `recoverable`
- store the returned `agentSessionId`
- initialize lifecycle timestamps and state

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts`
Expected: PASS for the new assertions

**Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/store/index.ts packages/server/src/__tests__/e2e.test.ts
git commit -m "feat: persist recoverable session metadata"
```

### Task 5: Normalize sessions on server startup

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/integration-session-history.test.ts`
- Test: `packages/server/src/__tests__/e2e.test.ts`

**Step 1: Write the failing tests**

Add tests that verify on startup:

- recoverable non-closed sessions become `suspended`
- non-recoverable non-closed sessions become `closed`
- history remains retrievable after normalization

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/integration-session-history.test.ts src/__tests__/e2e.test.ts`
Expected: FAIL because no startup normalization exists.

**Step 3: Write minimal implementation**

At server startup:

- call a store normalization routine before serving requests
- record close reasons for sessions that cannot be restored after restart

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/integration-session-history.test.ts src/__tests__/e2e.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/store/index.ts packages/server/src/__tests__/integration-session-history.test.ts packages/server/src/__tests__/e2e.test.ts
git commit -m "feat: normalize session lifecycle on startup"
```

### Task 6: Add idle suspension for recoverable sessions only

**Files:**
- Modify: `packages/server/src/session-manager/index.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/session-manager.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:

- recoverable active sessions suspend after 30 minutes idle
- non-recoverable active sessions do not suspend
- suspended sessions drop their bridge but keep persisted history and metadata

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/session-manager.test.ts`
Expected: FAIL because there is no idle-suspension logic.

**Step 3: Write minimal implementation**

Add:

- `last_active_at` updates on accepted prompt and agent updates
- a periodic idle sweep
- a suspend path that destroys the bridge, removes it from memory, and sets `status = suspended`

Do not suspend while a prompt is in flight.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/session-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/session-manager/index.ts packages/server/src/index.ts packages/server/src/store/index.ts packages/server/src/__tests__/session-manager.test.ts
git commit -m "feat: suspend recoverable idle sessions"
```

### Task 7: Make prompt handling restore suspended sessions

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/session-manager/index.ts`
- Modify: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/e2e.test.ts`
- Test: `packages/server/src/__tests__/integration-session-lifecycle.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:

- prompting a suspended recoverable session restores it and then forwards the prompt
- prompting a closed session returns an explicit error
- concurrent prompts do not trigger duplicate restores

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts src/__tests__/integration-session-lifecycle.test.ts`
Expected: FAIL because prompt handling currently no-ops when no bridge exists.

**Step 3: Write minimal implementation**

Refactor prompt handling to:

- load the session row first
- branch by persisted status
- restore suspended sessions before sending prompt
- return an explicit error for closed or unrecoverable sessions

Add per-session restore serialization.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts src/__tests__/integration-session-lifecycle.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/session-manager/index.ts packages/server/src/store/index.ts packages/server/src/__tests__/e2e.test.ts packages/server/src/__tests__/integration-session-lifecycle.test.ts
git commit -m "feat: restore suspended sessions on prompt"
```

### Task 8: Emit explicit lifecycle and error transport events

**Files:**
- Modify: `packages/server/src/api/transport/index.ts`
- Modify: `packages/server/src/api/ws/index.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/protocol/src/transport.ts`
- Test: `packages/server/src/__tests__/http-transport.test.ts`
- Test: `packages/server/src/__tests__/connection-manager.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:

- closed-session prompt attempts return an error payload
- suspended and restoring lifecycle changes are broadcast to subscribers
- `session:closed` can include a reason

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/http-transport.test.ts src/__tests__/connection-manager.test.ts`
Expected: FAIL because the transport layer currently only accepts the prompt and returns `202`.

**Step 3: Write minimal implementation**

Update transport routes and WebSocket handling so lifecycle changes and prompt failures become explicit protocol events instead of silent drops.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/http-transport.test.ts src/__tests__/connection-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/api/transport/index.ts packages/server/src/api/ws/index.ts packages/server/src/index.ts packages/protocol/src/transport.ts packages/server/src/__tests__/http-transport.test.ts packages/server/src/__tests__/connection-manager.test.ts
git commit -m "feat: expose lifecycle and prompt errors over transport"
```

### Task 9: Teach SDK session objects about lifecycle and prompt errors

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/session.ts`
- Test: `packages/sdk/src/__tests__/session-prompt-lifecycle.test.ts`
- Test: `packages/sdk/src/__tests__/error-handling.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:

- suspended and restoring events reach session listeners
- prompt error events clear pending callbacks
- closed-session errors do not leave prompt callbacks hanging

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/session-prompt-lifecycle.test.ts src/__tests__/error-handling.test.ts`
Expected: FAIL because SDK sessions only clear prompt state on `completed`.

**Step 3: Write minimal implementation**

Update SDK session handling to:

- surface lifecycle updates to listeners
- surface server errors for a session
- clear or reject prompt callbacks when a prompt cannot proceed

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/session-prompt-lifecycle.test.ts src/__tests__/error-handling.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/session.ts packages/sdk/src/__tests__/session-prompt-lifecycle.test.ts packages/sdk/src/__tests__/error-handling.test.ts
git commit -m "feat: handle lifecycle transitions in sdk sessions"
```

### Task 10: Update the client session list and chat view for lifecycle-aware UX

**Files:**
- Modify: `packages/client/src/components/layout/AppLayout.tsx`
- Modify: `packages/client/src/components/layout/Sidebar.tsx`
- Modify: `packages/client/src/components/layout/SessionItem.tsx`
- Modify: `packages/client/src/components/chat/SessionView.tsx`
- Modify: `packages/client/src/components/chat/StatusBar.tsx`
- Modify: `packages/client/src/components/PromptInput.tsx`
- Test: `packages/client/src/components/MessageList.test.tsx`
- Test: `packages/client/src/components/ThemeProvider.test.tsx`

**Step 1: Write the failing tests**

Add tests that verify:

- suspended sessions show as recoverable in the list
- closed sessions render as read-only
- restoring state disables input and shows restoring text
- restore failure or closed-session prompt attempt ends loading and shows an error

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/client test -- --run src/components/MessageList.test.tsx src/components/ThemeProvider.test.tsx`
Expected: FAIL because the UI only tracks a generic processing state.

**Step 3: Write minimal implementation**

Update the client to:

- display lifecycle state from session metadata
- split prompt activity from lifecycle activity
- stop relying on `completed` as the only way to clear loading
- make `closed` sessions read-only while still rendering history

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/client test -- --run src/components/MessageList.test.tsx src/components/ThemeProvider.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/components/layout/AppLayout.tsx packages/client/src/components/layout/Sidebar.tsx packages/client/src/components/layout/SessionItem.tsx packages/client/src/components/chat/SessionView.tsx packages/client/src/components/chat/StatusBar.tsx packages/client/src/components/PromptInput.tsx packages/client/src/components/MessageList.test.tsx packages/client/src/components/ThemeProvider.test.tsx
git commit -m "feat: render session lifecycle states in client"
```

### Task 11: Add end-to-end regression coverage for restart, suspend, and restore

**Files:**
- Modify: `packages/server/src/__tests__/e2e.test.ts`
- Modify: `packages/server/src/__tests__/integration-session-lifecycle.test.ts`
- Modify: `packages/sdk/src/__tests__/reconnection.test.ts`

**Step 1: Write the failing tests**

Add regression tests for:

- recoverable session restart normalization then lazy restore
- non-recoverable session restart closure
- idle suspension after 30 minutes
- no infinite loading after restore failure

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts src/__tests__/integration-session-lifecycle.test.ts`
Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/reconnection.test.ts`
Expected: FAIL until the full lifecycle behavior is complete.

**Step 3: Write minimal implementation adjustments**

Patch any remaining integration gaps without broad refactoring. Keep changes limited to lifecycle and restore correctness.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/e2e.test.ts src/__tests__/integration-session-lifecycle.test.ts`
Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/reconnection.test.ts`
Run: `pnpm --filter @matrix/client test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/__tests__/e2e.test.ts packages/server/src/__tests__/integration-session-lifecycle.test.ts packages/sdk/src/__tests__/reconnection.test.ts
git commit -m "test: cover session suspend and restore flows"
```

### Task 12: Final verification and cleanup

**Files:**
- Modify: `docs/plans/2026-03-14-session-lifecycle-recovery-design.md` if implementation constraints changed
- Modify: `docs/plans/2026-03-14-session-lifecycle-recovery-implementation.md` only if steps need correction

**Step 1: Run the focused server suite**

Run: `pnpm --filter @matrix/server test -- --run src/__tests__/store.test.ts src/__tests__/session-manager.test.ts src/__tests__/acp-bridge.test.ts src/__tests__/integration-session-history.test.ts src/__tests__/integration-session-lifecycle.test.ts src/__tests__/e2e.test.ts`
Expected: PASS

**Step 2: Run the focused SDK suite**

Run: `pnpm --filter @matrix/sdk test -- --run src/__tests__/client.test.ts src/__tests__/session-prompt-lifecycle.test.ts src/__tests__/error-handling.test.ts src/__tests__/reconnection.test.ts`
Expected: PASS

**Step 3: Run the client suite**

Run: `pnpm --filter @matrix/client test`
Expected: PASS

**Step 4: Review lifecycle behavior manually**

Verify manually:

- a recoverable session created before idle timeout appears active
- the same session becomes suspended after the timeout
- a prompt restores it
- a non-recoverable session never becomes suspended
- a restarted server closes non-recoverable sessions and keeps recoverable ones restorable

**Step 5: Commit**

```bash
git add docs/plans/2026-03-14-session-lifecycle-recovery-design.md docs/plans/2026-03-14-session-lifecycle-recovery-implementation.md
git commit -m "docs: finalize session lifecycle recovery plan"
```
