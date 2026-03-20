---
name: automation-bridge
description: |
  Use this skill when you need to verify, test, or interact with the running Matrix macOS dev client through the local automation bridge.
  Triggers: "verify the app", "test the client", "automation bridge", "check the UI", "interact with the app", "webview eval", "native invoke", "reset test state", "wait for condition", "screenshot", "dom snapshot", "diagnose UI", "debug test", "flaky test", "test failure", "debug e2e"
allowed-tools: Bash(curl *), Bash(cat *), Bash(ps *), Bash(pgrep *), Bash(kill *), Bash(pnpm *), Bash(sleep *), Read, Glob, Grep
---

# Automation Bridge

Interact with the running Matrix dev client through the WebSocket-based automation bridge on the Matrix server.

## Prerequisites

The dev app must be running:

```bash
pnpm dev:mac
```

## Step 1: Get Connection Info

Read `MATRIX_PORT` and `MATRIX_TOKEN` from `.env.local`:

```bash
set -a; source .env.local; set +a
export B="http://127.0.0.1:$MATRIX_PORT"
export T="$MATRIX_TOKEN"
```

## Step 2: Verify Health

```bash
curl --noproxy "*" -s -H "Authorization: Bearer $T" "$B/bridge/health" | python3 -m json.tool
```

Should show `clientCount > 0` before proceeding.

## Step 3: Use Endpoints

All requests require `Authorization: Bearer $T` and `--noproxy "*"` (to bypass system proxies on loopback).

### GET /bridge/health

Check bridge status and connected clients.

```bash
curl --noproxy "*" -s -H "Authorization: Bearer $T" "$B/bridge/health"
```

### GET /bridge/clients

List all connected webview clients.

```bash
curl --noproxy "*" -s -H "Authorization: Bearer $T" "$B/bridge/clients"
```

### POST /bridge/eval

Run a script inside the webview and get a JSON-safe result.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"script":"document.title"}' \
  "$B/bridge/eval"
```

### POST /bridge/event

Dispatch a named event into the frontend bridge.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"name":"automation:ping","payload":{}}' \
  "$B/bridge/event"
```

### DOM Snapshot (diagnose)

Capture DOM diagnostic state for debugging — testids, dialogs, focused element, and visible text. Uses `/bridge/eval` with a diagnostic script.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"script":"(()=>{const testids=Array.from(document.querySelectorAll(\"[data-testid]\")).map(el=>el.getAttribute(\"data-testid\"));const dialogs=Array.from(document.querySelectorAll(\".fixed\")).map(el=>el.className);const focused=document.activeElement?.tagName+\"#\"+document.activeElement?.getAttribute(\"data-testid\");const url=window.location.href;const bodyText=document.body.innerText.substring(0,500);return JSON.stringify({url,testids,dialogs,focused,bodyText},null,2)})()"}' \
  "$B/bridge/eval"
```

### POST /bridge/reset

Reset test state before repeating a scenario.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["automation-state"]}' \
  "$B/bridge/reset"
```

### POST /bridge/wait

Wait for a condition without polling manually. The `condition` is a JavaScript expression that should return truthy when the condition is met.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"condition":"window.__MATRIX_AUTOMATION__ != null","timeoutMs":5000,"intervalMs":100}' \
  "$B/bridge/wait"
```

## Error Codes

| Code | Meaning |
|------|---------|
| `401` | Missing or wrong bearer token |
| `502` | Client disconnected or eval failed |
| `408` | Wait condition not met within deadline |

## Recommended Workflow

1. Source `.env.local` for `MATRIX_PORT` and `MATRIX_TOKEN`
2. `GET /bridge/health` — confirm clientCount > 0
3. `GET /bridge/clients` — see connected clients
4. Use `/bridge/eval` for DOM assertions
5. Use `/bridge/event` to trigger frontend hooks
6. Use DOM snapshot (diagnose script via `/bridge/eval`) for test failure analysis
7. Use `/bridge/reset` before repeating scenarios
8. Use `/bridge/wait` instead of `sleep` loops

## Debugging Flaky E2E Tests

When an e2e test (`tests/release/flows/*.test.ts`) fails or is flaky, **DO NOT** repeatedly modify test code and rerun the full suite. Instead, manually replay the test steps via the bridge to find the exact step that breaks.

### Methodology

1. **Read the failing test** to understand its step-by-step flow
2. **Set up environment vars** for bridge access:
   ```bash
   set -a; source .env.local; set +a
   export B="http://127.0.0.1:$MATRIX_PORT"
   export T="$MATRIX_TOKEN"
   ```
3. **Replay each test step individually** via curl, checking the result after each one
4. **Use DOM snapshot between steps** to see what the UI actually looks like
5. **Once you find the broken step**, fix it, then verify the fix manually before updating test code

### Common UI Operations

**Click an element:**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"add-repo-btn\\\"]\"); el.dispatchEvent(new PointerEvent(\"pointerdown\",{bubbles:true,cancelable:true,pointerId:1})); el.dispatchEvent(new PointerEvent(\"pointerup\",{bubbles:true,cancelable:true,pointerId:1})); el.click(); })()"}' \
  "$B/bridge/eval"
```

**Type into an input (React-compatible):**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"chat-input\\\"]\"); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, \"value\")?.set; if(setter) setter.call(el, \"your text\"); else el.value=\"your text\"; el.dispatchEvent(new Event(\"input\",{bubbles:true})); el.dispatchEvent(new Event(\"change\",{bubbles:true})); })()"}' \
  "$B/bridge/eval"
```

**Check element existence:**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"!!document.querySelector(\"[data-testid=\\\"assistant-message\\\"]\")"}' \
  "$B/bridge/eval"
```

**Poll until condition is met:**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"condition":"!!document.querySelector(\"[data-testid=\\\"assistant-message\\\"]\")","timeoutMs":10000,"intervalMs":1000}' \
  "$B/bridge/wait"
```

### Server API Access

Access server API directly using the same token:

```bash
# Check repos, agents, config
curl -s -H "Authorization: Bearer $T" "$B/repositories"
curl -s -H "Authorization: Bearer $T" "$B/custom-agents"
curl -s -H "Authorization: Bearer $T" "$B/server/config"
```

### Key Gotchas

- **`HTMLInputElement.prototype.value.set` throws on `<textarea>`** — always check `el instanceof HTMLTextAreaElement` and use the matching prototype
- **After `window.location.reload()`, old DOM may still be queryable** — add 1.5s delay before polling to let the page tear down
- **`/bridge/eval` returns `502`** when the webview client is disconnected or the script throws — wrap scripts in try/catch during debugging
- **Multi-client**: If both macOS and iOS clients are connected, pass `clientId` to target a specific one

## Troubleshooting

- **No clients**: Check that the app webview loaded and connected to the bridge WebSocket
- **502 errors**: Client disconnected — check app logs
- **503 or HTML errors**: Add `--noproxy "*"` to curl commands
- **401 Unauthorized**: Check MATRIX_TOKEN matches what the server is using
- **Process died**: Restart with `pnpm dev:mac`

## Reference

Full protocol docs: `packages/client/AUTOMATION.md`
AI agent quick-start: `packages/client/AUTOMATION_FOR_AI.md`
