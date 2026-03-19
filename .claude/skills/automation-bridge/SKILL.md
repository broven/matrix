---
name: automation-bridge
description: |
  Use this skill when you need to verify, test, or interact with the running Matrix macOS dev client through the local automation bridge.
  Triggers: "verify the app", "test the client", "automation bridge", "check the UI", "interact with the app", "webview eval", "native invoke", "reset test state", "wait for condition"
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
7. Use `/test/reset` before repeating scenarios
8. Use `/wait` instead of `sleep` loops

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
