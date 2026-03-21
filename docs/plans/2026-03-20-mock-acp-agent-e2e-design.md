# Mock ACP Agent for E2E Tests

## Problem

E2e release tests (`tests/e2e/mac/`) currently depend on real ACP agents (Claude Code etc.) being installed. This makes tests fragile and slow — agent availability, API rate limits, and response latency all cause flakiness.

Additionally, the existing mock agent at `tests/e2e/mac/fixtures/mock-agent/index.mjs` uses outdated method names (`session/create`, `prompt/send`) that don't match the current ACP protocol.

## Design

### Mock Agent (`tests/e2e/mac/fixtures/mock-agent/index.mjs`)

Rewrite to match official ACP protocol (from `@agentclientprotocol/sdk`):

**Methods:**

| Method | Response |
|---|---|
| `initialize` | `{ protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name, version } }` |
| `session/new` | `{ sessionId, modes }` + send `available_commands_update` notification |
| `session/load` | `{ sessionId, modes }` |
| `session/prompt` | Send `agent_message_chunk` + `completed` notifications, then return `{ stopReason: "end_turn" }` |
| `session/cancel` | `{ ok: true }` |

**Prompt modes:**
- Default: `"Mock response to: <input>"`
- `echo:<text>`: echoes back text
- `env:<VAR>`: returns env var value

**Slash commands** (sent via `available_commands_update` after `session/new`):
- `/compact`, `/review`, `/plan` — matches what the slash command tests expect

Keep as `.mjs` — no build step, runs with `node` directly.

### Global Setup (`tests/e2e/mac/global-setup.ts`)

In `setup()`, after existing cleanup:

1. `POST /custom-agents` → register mock agent with `{ name: "Mock Agent", command: "node", args: ["<absolute-path>/tests/e2e/mac/fixtures/mock-agent/index.mjs"] }`
2. `PUT /server/config` → set `{ defaultAgent: "<returned-agent-id>" }`

In `teardown()`:

3. `DELETE /custom-agents/<id>` → remove mock agent

Store the agent ID in a module-level variable shared between setup/teardown.

### No Test Changes

Existing flow tests don't need changes because:
- `spawnAgentViaMessage()` sends "hi" and waits for response — mock agent responds instantly
- Slash command tests rely on `available_commands_update` — mock agent sends this after `session/new`
- Agent selection uses `defaultAgent` — UI auto-selects the mock agent

### What This Unblocks

- `pnpm test:e2e:mac` works without any real ACP agent installed
- `REAL_AGENT=1 pnpm test:e2e:mac` can still use real agents (skip mock registration when env var is set)

## Implementation Plan

### Step 1: Rewrite `tests/e2e/mac/fixtures/mock-agent/index.mjs`

Replace the entire file. Keep as `.mjs`, `#!/usr/bin/env node`, using `createInterface` from `node:readline`.

**Method handlers:**

```javascript
case "initialize":
  // Return: { protocolVersion: 1, serverCapabilities: { loadSession: true, promptCapabilities: {...} }, agentInfo: { name: "mock-acp-agent", title: "Mock ACP Agent", version: "1.0.0" } }

case "session/new":
  // Return: { sessionId: "mock_sess_<counter>", modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] } }
  // THEN send notification: session/update with available_commands_update containing /compact, /review, /plan

case "session/load":
  // Return: { sessionId: params.sessionId ?? generated, modes: same as above }

case "session/prompt":
  // Read params.prompt[0].text
  // "echo:<text>" → echo back text
  // "env:<VAR>" → return process.env[VAR]
  // default → "Mock response to: <text>"
  // Send notification: session/update with agent_message_chunk { type: "text", text: response }
  // Send notification: session/update with completed { stopReason: "end_turn" }
  // Return: { stopReason: "end_turn" }

case "session/cancel":
  // Return: { ok: true }
```

**Notification format** (must match what AcpBridge.handleMessage expects at line 219):
```javascript
{ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "...", ... } } }
```

**Test after writing:** `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node tests/e2e/mac/fixtures/mock-agent/index.mjs`

### Step 2: Update `tests/e2e/mac/global-setup.ts`

Add to `setup()` after the webview-ready poll:

```typescript
// Skip mock agent registration when using real agents
if (!process.env.REAL_AGENT) {
  const mockAgentPath = join(__dirname, "fixtures/mock-agent/index.mjs");
  // resolve to absolute path using import.meta or path.resolve
  const res = await fetch(`${sidecarUrl}/custom-agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sidecarToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Mock Agent", command: "node", args: [absolutePath] }),
  });
  const agent = await res.json();
  mockAgentId = agent.id;

  // Set as default agent
  await fetch(`${sidecarUrl}/server/config`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${sidecarToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ defaultAgent: agent.id }),
  });
}
```

Add to `teardown()`:
```typescript
if (mockAgentId) {
  await fetch(`${sidecarUrl}/custom-agents/${mockAgentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sidecarToken}` },
  }).catch(() => {});
}
```

Module-level: `let mockAgentId: string | null = null;`

### Step 3: Verify mock agent works standalone

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' | node tests/e2e/mac/fixtures/mock-agent/index.mjs
```

Expected: JSON response with protocolVersion, serverCapabilities, agentInfo.

### Step 4: Verify build and tests

```bash
pnpm -r build && pnpm -r test
```

All 233+ tests must pass. No test file changes needed.
