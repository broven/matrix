# Automation Bridge For AI

Use this document when an AI agent needs to verify the macOS dev client through the local automation bridge.

## What This Is

`packages/client` exposes a development-only HTTP automation bridge for the native app.

The bridge lets an AI agent:

- discover the running app
- authenticate with a bearer token
- inspect app and webview state
- run controlled webview scripts
- dispatch webview events
- invoke whitelisted native actions
- reset test state
- wait on conditions

The full developer reference is in [AUTOMATION.md](./AUTOMATION.md). This file is the short AI-oriented version.

## Standard Workflow

1. Start the dev app:

```bash
pnpm --filter @matrix/client tauri:dev
```

2. Read the discovery file:

- default path on macOS:
  - `~/Library/Application Support/Matrix/dev/automation.json`
- optional override:
  - `MATRIX_AUTOMATION_DISCOVERY_DIR=/some/path`

3. Parse `automation.json` and extract:

- `baseUrl`
- `token`
- `platform`

4. Send all bridge requests with:

```text
Authorization: Bearer <token>
```

5. Recommended request order:

- `GET /health`
- `GET /state`
- `POST /webview/eval`
- `POST /webview/event`
- `POST /native/invoke`
- `POST /native/screenshot`
- `POST /test/reset`
- `POST /wait`

## Discovery File

Example:

```json
{
  "enabled": true,
  "platform": "macos",
  "baseUrl": "http://127.0.0.1:18765",
  "token": "dev-...",
  "pid": 12345
}
```

Use `baseUrl` as the HTTP endpoint root. Use `token` for every request.

## Endpoints

### `GET /health`

Use first. Confirms whether the app, webview, and sidecar are ready.

Expected shape:

```json
{
  "ok": true,
  "platform": "macos",
  "appReady": true,
  "webviewReady": true,
  "sidecarReady": true
}
```

### `GET /state`

Use to inspect current window, webview, and sidecar state before making assertions.

Typical shape:

```json
{
  "window": {
    "label": "main",
    "focused": true,
    "visible": true
  },
  "webview": {
    "url": "http://127.0.0.1:19880"
  },
  "sidecar": {
    "running": true,
    "port": 19880
  }
}
```

### `POST /webview/eval`

Run a controlled script inside the webview and get a JSON-safe result back.

Request:

```json
{
  "script": "window.location.href"
}
```

### `POST /webview/event`

Dispatch a named automation event into the frontend bridge.

Request:

```json
{
  "name": "automation:seed-session",
  "payload": {
    "agentId": "codex"
  }
}
```

### `POST /native/invoke`

Invoke a whitelisted native action.

Desktop actions currently supported:

- `window.focus`
- `window.reload`
- `sidecar.status`

Request:

```json
{
  "action": "window.reload"
}
```

### `POST /native/screenshot`

Capture a screenshot of the application window. Returns raw PNG bytes with `Content-Type: image/png`.

No request body is needed.

On success the response is raw PNG image data (not JSON). On failure the response is a JSON envelope with an error code.

Example with curl:

```bash
curl --noproxy "*" -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/native/screenshot" > /tmp/screenshot.png
```

### `POST /test/reset`

Reset test state. Use this before repeating a scenario.

Request:

```json
{
  "scopes": ["web-storage", "automation-state"]
}
```

### `POST /wait`

Wait for a condition without open-coded polling in the agent.

Example:

```json
{
  "timeoutMs": 5000,
  "intervalMs": 100,
  "condition": {
    "kind": "webview.eval",
    "script": "window.__MATRIX_AUTOMATION__ != null"
  }
}
```

## Error Codes

Stable bridge error codes include:

- `unauthorized`
- `invalid_json`
- `unsupported_action`
- `unsupported_condition`
- `timeout`
- `webview_unavailable`
- `native_unavailable`
- `reset_failed`
- `internal_error`

## Recommended Agent Prompt

Use this as a baseline instruction for another AI agent:

```text
This project exposes a local automation bridge for the macOS dev client.
Start the app with `pnpm --filter @matrix/client tauri:dev`.
Then read `~/Library/Application Support/Matrix/dev/automation.json` to get `baseUrl` and `token`.
Send all requests with `Authorization: Bearer <token>`.
Always begin with `GET /health` and `GET /state`.
Use `/webview/eval` for DOM or frontend assertions, `/webview/event` to trigger frontend hooks, `/native/invoke` for whitelisted native actions, `/native/screenshot` to capture a window screenshot as PNG, `/test/reset` to reset state, and `/wait` instead of ad hoc sleeps.
If the discovery path is overridden, prefer `MATRIX_AUTOMATION_DISCOVERY_DIR`.
Read `packages/client/AUTOMATION.md` only if more protocol detail is needed.
```

## Notes

- The bridge is dev/test only.
- It listens on loopback only.
- The current live startup path is desktop-first.
- The iOS simulator adapter exists in code, but the validated live path is currently macOS desktop.
