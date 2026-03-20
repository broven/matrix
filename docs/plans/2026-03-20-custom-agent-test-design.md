# Custom Agent ACP Protocol Test

## Problem

Users can add custom ACP agents by providing command/args/env, but have no way to verify the agent actually works before saving. If the command doesn't exist, doesn't speak ACP, or fails at any step, users only discover this when trying to create a session.

## Design

### API

`POST /custom-agents/test`

```typescript
// Request
{
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Response
{
  steps: [
    { name: "spawn", status: "pass" | "fail" | "skipped", error?: string, durationMs: number },
    { name: "initialize", status: "pass" | "fail" | "skipped", error?: string, durationMs: number },
    { name: "session/new", status: "pass" | "fail" | "skipped", error?: string, durationMs: number },
    { name: "prompt", status: "pass" | "fail" | "skipped", error?: string, durationMs: number },
  ]
}
```

Rules:
- Each step depends on the previous one; if a step fails, subsequent steps are `skipped`
- Agent process is killed after test completes (pass or fail)
- Overall timeout: 15 seconds
- Per-step timeout: 5 seconds (spawn gets 3 seconds)

### Server Implementation

New function `testAcpAgent()` in `custom-agents.ts`. Lightweight — does NOT reuse AcpBridge (too much session management overhead). Instead, directly:

1. **spawn** — `spawn(command, args, { env: {...process.env, ...env}, stdio: ['pipe','pipe','pipe'] })`. Pass if process starts without error event within 1 second.
2. **initialize** — Write JSON-RPC `initialize` request to stdin, read response from stdout. 5s timeout.
3. **session/new** — Write `session/new { cwd: os.tmpdir() }`, read response. 5s timeout.
4. **prompt** — Write `session/prompt` with `[{type:"text", text:"hello"}]`, wait for any response/notification. 5s timeout.
5. **cleanup** — Kill process, drain stdio.

### Input Validation

Same `validateAgentPayload()` applied to test request body. `command` and `args` are required (no `name` needed for test).

### SDK

```typescript
// MatrixClient
async testCustomAgent(config: { command: string; args: string[]; env?: Record<string, string> }): Promise<TestResult>
```

### UI — AgentDialog

- "Test" button next to "Save" button
- Click → button shows spinner + "Testing..."
- On complete → show step results below the form fields:
  ```
  ✓ spawn (120ms)
  ✓ initialize (340ms)
  ✓ session/new (210ms)
  ✗ prompt — Timed out after 5000ms (5000ms)
  ```
- Green checkmark for pass, red X for fail, gray dash for skipped
- Results persist until dialog closes or user clicks Test again

### UI — Agent List

- Small "play" icon button on each custom agent row (between Edit and Delete)
- Click → icon becomes spinner
- On complete → expand a results panel below the agent row (same format as dialog)
- data-testid: `test-agent-btn-{agentId}`

## Implementation Order

1. Server: `testAcpAgent()` function + `POST /custom-agents/test` endpoint
2. SDK: `testCustomAgent()` method
3. UI: Test button + results in AgentDialog
4. UI: Test button + results in agent list row
