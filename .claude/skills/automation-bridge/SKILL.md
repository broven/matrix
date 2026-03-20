---
name: automation-bridge
description: |
  Use this skill when you need to verify, test, or interact with the running Matrix macOS dev client through the local automation bridge.
  Triggers: "verify the app", "test the client", "automation bridge", "check the UI", "interact with the app", "webview eval", "native invoke", "reset test state", "wait for condition", "screenshot", "dom snapshot", "diagnose UI", "debug test", "flaky test", "test failure", "debug e2e"
allowed-tools: Bash(curl *), Bash(cat *), Bash(ps *), Bash(pgrep *), Bash(kill *), Bash(pnpm *), Bash(sleep *), Read, Glob, Grep
---

# Automation Bridge

Interact with the running Matrix macOS dev client through the local HTTP automation bridge.

## Prerequisites

The dev app must be running:

```bash
pnpm dev:mac
```

## Step 1: Read Discovery

```bash
cat ~/Library/Application\ Support/Matrix/dev/automation.json
```

This returns:

```json
{
  "enabled": true,
  "platform": "macos",
  "baseUrl": "http://127.0.0.1:18765",
  "token": "dev-...",
  "pid": 12345
}
```

Extract `baseUrl` and `token`. Verify the process is alive:

```bash
ps -p <pid> -o comm=
```

If the process is dead, restart the app.

## Step 2: Verify Health

```bash
curl --noproxy "*" -s -H "Authorization: Bearer <token>" "<baseUrl>/health" | python3 -m json.tool
```

All fields should be `true` before proceeding.

## Step 3: Use Endpoints

All requests require `Authorization: Bearer <token>` and `--noproxy "*"` (to bypass system proxies on loopback).

### GET /health

Check app readiness.

```bash
curl --noproxy "*" -s -H "Authorization: Bearer $TOKEN" "$BASE/health"
```

### GET /state

Inspect window, webview, and sidecar state.

```bash
curl --noproxy "*" -s -H "Authorization: Bearer $TOKEN" "$BASE/state"
```

### POST /webview/eval

Run a script inside the webview and get a JSON-safe result.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script":"window.location.href"}' \
  "$BASE/webview/eval"
```

### POST /webview/event

Dispatch a named event into the frontend bridge.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"automation:ping","payload":{}}' \
  "$BASE/webview/event"
```

### POST /native/invoke

Invoke a whitelisted native action. Supported: `window.focus`, `window.reload`, `sidecar.status`.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"sidecar.status"}' \
  "$BASE/native/invoke"
```

### POST /native/screenshot

Capture a PNG screenshot of the Matrix window only (not full screen). Returns binary PNG data. Works even when the window is occluded by other windows.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/matrix-screenshot.png \
  "$BASE/native/screenshot"
```

Verify the result:

```bash
file /tmp/matrix-screenshot.png
# PNG image data, 1280 x 900, 8-bit/color RGBA, non-interlaced
```

### DOM Snapshot (diagnose)

Capture DOM diagnostic state for debugging — testids, dialogs, focused element, and visible text. Uses `/webview/eval` with a diagnostic script.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script":"(()=>{const testids=Array.from(document.querySelectorAll(\"[data-testid]\")).map(el=>el.getAttribute(\"data-testid\"));const dialogs=Array.from(document.querySelectorAll(\".fixed\")).map(el=>el.className);const focused=document.activeElement?.tagName+\"#\"+document.activeElement?.getAttribute(\"data-testid\");const url=window.location.href;const bodyText=document.body.innerText.substring(0,500);return JSON.stringify({url,testids,dialogs,focused,bodyText},null,2)})()"}' \
  "$BASE/webview/eval"
```

Returns:

```json
{
  "ok": true,
  "result": "{\"url\":\"...\",\"testids\":[\"add-repo-btn\",\"settings-btn\",...],\"dialogs\":[...],\"focused\":\"BODY#null\",\"bodyText\":\"...\"}"
}
```

### POST /test/reset

Reset test state before repeating a scenario. Scopes: `web-storage`, `indexed-db`, `automation-state`, `session-cache`, `sidecar`.

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["automation-state"]}' \
  "$BASE/test/reset"
```

### POST /wait

Wait for a condition without polling manually.

**webview.eval** — poll until script returns truthy:

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timeoutMs":5000,"intervalMs":100,"condition":{"kind":"webview.eval","script":"window.__MATRIX_AUTOMATION__ != null"}}' \
  "$BASE/wait"
```

**state.match** — poll until route state path equals expected value:

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timeoutMs":5000,"intervalMs":100,"condition":{"kind":"state.match","path":"sidecar.running","equals":true}}' \
  "$BASE/wait"
```

## Error Codes

| Code | Meaning |
|------|---------|
| `unauthorized` | Missing or wrong bearer token |
| `invalid_json` | Request body is not valid JSON |
| `unsupported_action` | Native action not in whitelist |
| `unsupported_condition` | Wait condition kind not recognized |
| `timeout` | Wait condition not met within deadline |
| `webview_unavailable` | Frontend bridge not responding |
| `native_unavailable` | Native capability not available |
| `reset_failed` | Test reset capability not available |
| `internal_error` | Unexpected server error |

## Recommended Workflow

1. Read discovery file, extract `baseUrl` and `token`
2. `GET /health` — confirm all ready
3. `GET /state` — understand current state
4. Use `/webview/eval` for DOM assertions
5. Use `/webview/event` to trigger frontend hooks
6. Use `/native/invoke` for window/sidecar control
7. Use `/native/screenshot` to capture window PNG for visual debugging
8. Use DOM snapshot (diagnose script via `/webview/eval`) for test failure analysis
9. Use `/test/reset` before repeating scenarios
10. Use `/wait` instead of `sleep` loops

## Debugging Flaky E2E Tests

When an e2e test (`tests/release/flows/*.test.ts`) fails or is flaky, **DO NOT** repeatedly modify test code and rerun the full suite. Instead, manually replay the test steps via the bridge to find the exact step that breaks.

### Methodology

1. **Read the failing test** to understand its step-by-step flow
2. **Set up environment vars** for bridge access:
   ```bash
   export T=$(cat ~/Library/Application\ Support/Matrix/dev/automation.json | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
   export B=$(cat ~/Library/Application\ Support/Matrix/dev/automation.json | python3 -c "import sys,json; print(json.load(sys.stdin)['baseUrl'])")
   ```
3. **Replay each test step individually** via curl, checking the result after each one
4. **Use DOM snapshot between steps** to see what the UI actually looks like
5. **Once you find the broken step**, fix it, then verify the fix manually before updating test code

### Common UI Operations

**Click an element:**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"add-repo-btn\\\"]\"); el.dispatchEvent(new PointerEvent(\"pointerdown\",{bubbles:true,cancelable:true,pointerId:1})); el.dispatchEvent(new PointerEvent(\"pointerup\",{bubbles:true,cancelable:true,pointerId:1})); el.click(); })()"}' \
  "$B/webview/eval"
```

**Type into an input (React-compatible, works for both `<input>` and `<textarea>`):**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"chat-input\\\"]\"); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, \"value\")?.set; if(setter) setter.call(el, \"your text\"); else el.value=\"your text\"; el.dispatchEvent(new Event(\"input\",{bubbles:true})); el.dispatchEvent(new Event(\"change\",{bubbles:true})); })()"}' \
  "$B/webview/eval"
```

**Send a chat message (React _valueTracker trick + Enter keydown):**
```bash
# Step 1: Set value with _valueTracker
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"chat-input\\\"]\"); el.focus(); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, \"value\").set; s.call(el, \"hi\"); const t = el._valueTracker; if(t) t.setValue(\"\"); el.dispatchEvent(new Event(\"input\",{bubbles:true})); })()"}' \
  "$B/webview/eval"
# Step 2: Submit via Enter (after 500ms)
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"(() => { const el = document.querySelector(\"[data-testid=\\\"chat-input\\\"]\"); el.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Enter\",code:\"Enter\",keyCode:13,bubbles:true,cancelable:true})); })()"}' \
  "$B/webview/eval"
```

**Check element existence:**
```bash
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"script":"!!document.querySelector(\"[data-testid=\\\"assistant-message\\\"]\")"}' \
  "$B/webview/eval"
```

**Poll until condition is met:**
```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  RES=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
    -d '{"script":"!!document.querySelector(\"[data-testid=\\\"assistant-message\\\"]\")"}' "$B/webview/eval")
  if echo "$RES" | grep -q '"result":true'; then echo "Ready after ${i}s"; break; fi
  sleep 1
done
```

### Sidecar API Access

Some debugging requires checking server-side state:

```bash
# Get sidecar connection info
STATE=$(curl -s -H "Authorization: Bearer $T" "$B/state")
SIDECAR_PORT=$(echo "$STATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['sidecar']['port'])")
ST=$(curl -s "http://127.0.0.1:$SIDECAR_PORT/api/auth-info" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Check repos, agents, config
curl -s -H "Authorization: Bearer $ST" "http://127.0.0.1:$SIDECAR_PORT/repositories"
curl -s -H "Authorization: Bearer $ST" "http://127.0.0.1:$SIDECAR_PORT/custom-agents"
curl -s -H "Authorization: Bearer $ST" "http://127.0.0.1:$SIDECAR_PORT/server/config"
```

### Key Gotchas Found Through Manual Debugging

- **`HTMLInputElement.prototype.value.set` throws on `<textarea>`** — always check `el instanceof HTMLTextAreaElement` and use the matching prototype
- **`removeAllRepos` via API doesn't update UI** — must `window.reload` + wait after API-level cleanup
- **`spawnAgentViaMessage` may return instantly** if input was never disabled — wait for `assistant-message` to appear instead
- **After `window.reload`, old DOM may still be queryable** — add 1.5s delay before polling to let the page tear down
- **`webview/eval` returns `internal_error`** when the evaluated JS throws — the error message is not passed through, so wrap scripts in try/catch during debugging

## Troubleshooting

- **Bridge not starting**: Check app console for `Automation bridge failed to start`
- **Discovery missing**: Confirm app is running in dev mode
- **503 or HTML errors**: Add `--noproxy "*"` to curl commands
- **401 Unauthorized**: Use the token from the current `automation.json`
- **webview_unavailable**: Frontend bridge not installed or timed out — wait and retry
- **Process died**: Restart with `pnpm dev:mac`

## Reference

Full protocol docs: `packages/client/AUTOMATION.md`
AI agent quick-start: `packages/client/AUTOMATION_FOR_AI.md`
