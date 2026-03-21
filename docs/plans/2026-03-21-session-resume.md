# Session Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to resume closed Matrix sessions by leveraging Claude ACP's `session/load` capability, so conversation context is preserved across session closures and server restarts.

**Architecture:** Add a `POST /sessions/:id/resume` REST endpoint that transitions a closed session back to active. On the next prompt, the existing lazy-init flow detects `agentId` is set but no bridge exists, and uses `session/load` with the stored `agentSessionId` to resume the Claude conversation. The client adds a "Resume" button on closed sessions.

**Tech Stack:** TypeScript, Hono (server), React (client), SQLite (store), Vitest (tests)

---

### Task 1: Store — add `reopenSession` method

**Files:**
- Modify: `packages/server/src/store/index.ts` (after `closeSession` at ~line 487)
- Test: `packages/server/src/__tests__/session-manager.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/src/__tests__/session-manager.test.ts` at the end of the file, inside a new `describe("store.reopenSession")` block:

```typescript
describe("store.reopenSession", () => {
  it("transitions a closed session back to active", () => {
    store.createSession("sess_reopen", "agent-1", "/tmp", {
      recoverable: true,
      agentSessionId: "claude-abc",
    });
    store.closeSession("sess_reopen");

    const before = store.getSession("sess_reopen");
    expect(before?.status).toBe("closed");

    store.reopenSession("sess_reopen");

    const after = store.getSession("sess_reopen");
    expect(after?.status).toBe("active");
    expect(after?.closeReason).toBeNull();
    expect(after?.suspendedAt).toBeNull();
    expect(after?.agentSessionId).toBe("claude-abc");
  });

  it("is a no-op for already active sessions", () => {
    store.createSession("sess_active", "agent-1", "/tmp");
    store.reopenSession("sess_active");
    expect(store.getSession("sess_active")?.status).toBe("active");
  });

  it("throws for non-existent sessions", () => {
    expect(() => store.reopenSession("sess_nope")).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/session-manager.test.ts --reporter=verbose`
Expected: FAIL — `store.reopenSession is not a function`

**Step 3: Write minimal implementation**

In `packages/server/src/store/index.ts`, add after `closeSession` method (~line 487):

```typescript
reopenSession(sessionId: string): void {
  const session = this.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (session.status === "active") return;

  this.updateSessionState(sessionId, {
    status: "active",
    suspendedAt: null,
    closeReason: null,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/session-manager.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/store/index.ts packages/server/src/__tests__/session-manager.test.ts
git commit -m "feat(store): add reopenSession method for transitioning closed→active"
```

---

### Task 2: REST endpoint — `POST /sessions/:id/resume`

**Files:**
- Modify: `packages/server/src/api/rest/sessions.ts`
- Test: `packages/server/src/__tests__/integration-session-lifecycle.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/src/__tests__/integration-session-lifecycle.test.ts`:

```typescript
it("POST /sessions/:id/resume reopens a closed session", async () => {
  // Create and close a session
  const createRes = await app.request("/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: "/tmp" }),
  });
  const { sessionId } = await createRes.json();

  // Simulate having an agent and closing
  store.updateSessionState(sessionId, {
    agentId: "test-agent",
    recoverable: true,
    agentSessionId: "claude-xyz",
  });
  store.closeSession(sessionId);
  expect(store.getSession(sessionId)?.status).toBe("closed");

  // Resume
  const resumeRes = await app.request(`/sessions/${sessionId}/resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(resumeRes.status).toBe(200);
  const body = await resumeRes.json();
  expect(body.sessionId).toBe(sessionId);

  const session = store.getSession(sessionId);
  expect(session?.status).toBe("active");
  expect(session?.agentSessionId).toBe("claude-xyz");
});

it("POST /sessions/:id/resume returns 404 for unknown session", async () => {
  const res = await app.request("/sessions/sess_unknown/resume", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(404);
});

it("POST /sessions/:id/resume returns 409 if session has no agentSessionId", async () => {
  const createRes = await app.request("/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: "/tmp" }),
  });
  const { sessionId } = await createRes.json();
  store.closeSession(sessionId);

  const res = await app.request(`/sessions/${sessionId}/resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(409);
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/integration-session-lifecycle.test.ts --reporter=verbose`
Expected: FAIL — 404 (route not defined)

**Step 3: Write minimal implementation**

In `packages/server/src/api/rest/sessions.ts`, add before the `return app;` line:

```typescript
app.post("/sessions/:id/resume", (c) => {
  const sessionId = c.req.param("id");
  const session = store.getSession(sessionId);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  if (session.status === "active") {
    return c.json({ sessionId });
  }
  if (!session.agentSessionId) {
    return c.json({ error: "Session has no agent conversation to resume" }, 409);
  }

  store.reopenSession(sessionId);
  connectionManager.broadcastToAll({
    type: "server:session_resumed",
    sessionId,
  });

  return c.json({ sessionId });
});
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/integration-session-lifecycle.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/api/rest/sessions.ts packages/server/src/__tests__/integration-session-lifecycle.test.ts
git commit -m "feat(api): add POST /sessions/:id/resume endpoint"
```

---

### Task 3: Server — wire resume into handlePrompt flow

The existing `handlePrompt` already handles the case where `session.agentId` is set but no bridge exists (lines 156-179 in `index.ts`). When a session is reopened:
- `session.status` is `"active"` (set by `reopenSession`)
- `session.agentId` is set (from original session)
- `session.agentSessionId` is set (from original session)
- `session.recoverable` is `true`
- No bridge is registered in SessionManager

This means **the existing restore path already handles it**: lines 156-162 check `session.recoverable && session.agentSessionId` and call `sessionManager.restoreSession()` which calls `createBridge(... restoreAgentSessionId)` which calls `bridge.loadSession()`.

**Files:**
- Modify: `packages/server/src/index.ts` — only need to remove the `status === "closed"` early return
- Test: `packages/server/src/__tests__/session-manager.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/src/__tests__/session-manager.test.ts`:

```typescript
describe("restoreSession after reopen", () => {
  it("restores a reopened session via bridge factory with agentSessionId", async () => {
    const newBridge = createMockBridge();
    const factory = vi.fn().mockResolvedValue({
      bridge: newBridge,
      modes: { currentModeId: "code", availableModes: [] },
      recoverable: true,
      agentSessionId: "claude-resumed",
    });
    sessionManager.setBridgeFactory(factory);

    store.createSession("sess_r", "agent-1", "/tmp", {
      recoverable: true,
      agentSessionId: "claude-original",
    });
    store.closeSession("sess_r");
    store.reopenSession("sess_r");

    const bridge = await sessionManager.restoreSession("sess_r", store);
    expect(bridge).toBe(newBridge);

    // Factory should be called with the stored agentSessionId
    expect(factory).toHaveBeenCalledWith(
      "sess_r",
      "agent-1",
      "/tmp",
      "claude-original",
      undefined,
    );

    // Store should be updated
    const session = store.getSession("sess_r");
    expect(session?.status).toBe("active");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/session-manager.test.ts --reporter=verbose`
Expected: FAIL — `restoreSession` returns `null` because it checks `session.status !== "active"` indirectly (the store gate in `restoreSession` checks `!session.recoverable` — but after `reopenSession` status is active and recoverable is true, so this should actually work)

Wait — let me re-read `restoreSession`. It checks:
```
!session || !session.agentId || !session.recoverable || !session.agentSessionId
```
After `reopenSession`, all of these are set. So this test should **pass without code changes** in the session manager. The only blocker is that `handlePrompt` in `index.ts` rejects `status === "closed"` sessions. But after `reopenSession`, status is `"active"`, so it proceeds.

Actually, this test should pass as-is once Task 1 is done. Let's verify.

**Step 2 (revised): Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/session-manager.test.ts --reporter=verbose`
Expected: PASS — the existing restore path works for reopened sessions

**Step 3: No code changes needed in session-manager**

The existing `handlePrompt` flow in `index.ts` already works because:
1. `reopenSession()` sets `status = "active"` → passes the `status === "closed"` check
2. No bridge in SessionManager → falls to restore path (line 156)
3. `session.recoverable && session.agentSessionId` are preserved → `restoreSession()` fires
4. `restoreSession()` calls factory with `session.agentSessionId` → `bridge.loadSession()` resumes the Claude conversation

**The only server-side change needed is confirming this works end-to-end via the test.**

**Step 4: Commit**

```bash
git add packages/server/src/__tests__/session-manager.test.ts
git commit -m "test: verify session restore works for reopened sessions"
```

---

### Task 4: Protocol — add `server:session_resumed` event type

**Files:**
- Modify: `packages/protocol/src/session.ts`
- Modify: `packages/protocol/src/api.ts` (no change needed — SessionInfo already has all fields)

**Step 1: Check if session event types are defined**

Look at `packages/protocol/src/session.ts` for existing event type definitions. If `server:session_resumed` is just a broadcast message (like `server:session_created` and `server:session_closed`), it may not need a protocol type — it's a WebSocket message shape.

Check how `server:session_created` is typed. If it's untyped (inline `{ type: string, ... }`), follow the same pattern.

**Step 2: No protocol changes needed if events are untyped**

The `connectionManager.broadcastToAll()` calls in `index.ts` already use inline objects. Follow the same pattern in Task 2.

**Step 3: Commit (skip if no changes)**

---

### Task 5: SDK — add `resumeSession` method to client

**Files:**
- Modify: `packages/sdk/src/client.ts`

**Step 1: Read the existing client to understand the fetch pattern**

The client has methods like `createSession`, `deleteSession`, etc. that use `this.fetch()`.

**Step 2: Add resumeSession method**

In `packages/sdk/src/client.ts`, add after `createSession`:

```typescript
async resumeSession(sessionId: string): Promise<{ sessionId: string }> {
  const res = await this.fetch(`/sessions/${sessionId}/resume`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to resume session: ${res.status}`);
  }
  return res.json();
}
```

**Step 3: Commit**

```bash
git add packages/sdk/src/client.ts
git commit -m "feat(sdk): add resumeSession method"
```

---

### Task 6: Client — handle `server:session_resumed` event

**Files:**
- Modify: `packages/client/src/components/layout/AppLayout.tsx` (~line 148, in the event handler switch)
- Modify: `packages/client/src/hooks/useServerData.tsx` (~line 93, same pattern)
- Modify: `packages/client/src/hooks/useAllServersData.tsx` (~line 159, same pattern)

**Step 1: Add event handler in AppLayout**

In `AppLayout.tsx`, in the `switch` block that handles `server:session_created` and `server:session_closed`, add:

```typescript
case "server:session_resumed":
  setSessions((prev) =>
    prev.map((s) =>
      s.sessionId === event.sessionId
        ? { ...s, status: "active", closeReason: null, suspendedAt: null }
        : s
    )
  );
  break;
```

Do the same in `useServerData.tsx` and `useAllServersData.tsx`.

**Step 2: Commit**

```bash
git add packages/client/src/components/layout/AppLayout.tsx packages/client/src/hooks/useServerData.tsx packages/client/src/hooks/useAllServersData.tsx
git commit -m "feat(client): handle server:session_resumed event"
```

---

### Task 7: Client — add Resume button on closed sessions

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx`

**Step 1: Add resume handler and UI**

In `SessionView.tsx`:

1. Add `onResumeSession` prop to `SessionViewProps`:
```typescript
interface SessionViewProps {
  serverId: string;
  sessionInfo: SessionInfo;
  agents: AgentListItem[];
  onSessionInfoChange?: (sessionId: string, patch: Partial<SessionInfo>) => void;
  onNavigateSettings?: () => void;
  onResumeSession?: (sessionId: string) => Promise<void>;
}
```

2. Destructure the new prop and add a resume handler:
```typescript
const handleResume = useCallback(async () => {
  if (!onResumeSession) return;
  try {
    await onResumeSession(sessionInfo.sessionId);
    setViewStatus("active");
    setErrorMessage(null);
  } catch (err) {
    setErrorMessage(err instanceof Error ? err.message : "Failed to resume session");
  }
}, [onResumeSession, sessionInfo.sessionId]);
```

3. Update the closed-session status message area. In the `getStatusMessage` function, keep it as-is. Instead, add a resume button in the `StatusBar` or next to the status message. The simplest approach: when `viewStatus === "closed"` and `sessionInfo.agentSessionId` exists, show a "Resume" button below the status bar.

Add before the `<PromptInput>` component, conditionally:
```tsx
{viewStatus === "closed" && sessionInfo.agentSessionId && onResumeSession && (
  <div className="flex justify-center border-t px-4 py-3">
    <button
      type="button"
      onClick={handleResume}
      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      data-testid="resume-session-btn"
    >
      Resume conversation
    </button>
  </div>
)}
```

4. When session is closed AND has no `agentSessionId`, keep showing "This session is closed" with no resume option (session was never used / non-resumable).

**Step 2: Wire up in AppLayout**

In `AppLayout.tsx`, add a `handleResumeSession` function:
```typescript
const handleResumeSession = async (sessionId: string) => {
  if (!client) return;
  await client.resumeSession(sessionId);
};
```

Pass it to `SessionView`:
```tsx
<SessionView
  ...
  onResumeSession={handleResumeSession}
/>
```

**Step 3: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat(client): add Resume button for closed sessions with conversation history"
```

---

### Task 8: Hide PromptInput when closed (cleanup)

Currently `PromptInput` is shown but disabled when closed. After adding the Resume button, hide `PromptInput` entirely when closed to avoid confusion:

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx`

**Step 1: Conditionally render PromptInput**

Replace the existing `<PromptInput ... />` with:
```tsx
{viewStatus !== "closed" && (
  <PromptInput
    onSend={handleSend}
    disabled={inputDisabled}
    placeholder={getInputPlaceholder(viewStatus, hasAgent, noAgentAvailable)}
    isProcessing={isProcessing}
    agents={agents}
    selectedAgentId={selectedAgentId}
    selectedProfileId={selectedProfileId}
    onAgentChange={setSelectedAgentId}
    onProfileChange={setSelectedProfileId}
    availableCommands={availableCommands}
    agentLocked={Boolean(sessionInfo.agentId && agents.some((a) => a.id === sessionInfo.agentId && a.available))}
    noAgentAvailable={noAgentAvailable}
  />
)}
```

**Step 2: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat(client): hide prompt input on closed sessions, show only resume button"
```

---

### Task 9: Run full test suite and verify

**Step 1: Run server tests**

Run: `cd packages/server && npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 2: Run SDK tests**

Run: `cd packages/sdk && npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 3: Run client tests**

Run: `cd packages/client && npx vitest run --reporter=verbose`
Expected: All tests pass (or fix any existing test that needs the new prop)

**Step 4: Build all packages**

Run: `npm run build` (or equivalent workspace build command)
Expected: Clean build

**Step 5: Commit any fixes**

---

## Summary of Changes

| Layer | Change | Purpose |
|-------|--------|---------|
| Store | `reopenSession()` method | Transition `closed → active` |
| REST API | `POST /sessions/:id/resume` | Client-callable resume endpoint |
| Server | No changes needed | Existing restore path handles it |
| Protocol | No schema changes | `SessionInfo` already has all fields |
| SDK | `resumeSession()` method | Client SDK wrapper |
| Client events | Handle `server:session_resumed` | Reactive state update |
| Client UI | Resume button on closed sessions | User-facing resume action |

## Key Insight

The heavy lifting (ACP `session/load`, bridge factory, lazy restore) is already implemented for the idle-suspend flow. Session resume is primarily a **state machine change** (allowing `closed → active` transition) plus **UI surface** (resume button). The ACP conversation restoration is free.
