# Automation Bridge For AI

Use this document when an AI agent needs to verify the Matrix dev client through the automation bridge.

## What This Is

The Matrix server exposes a WebSocket-based automation bridge that lets an AI agent:

- inspect connected app clients
- run controlled webview scripts
- dispatch webview events
- reset test state
- wait on conditions

The full developer reference is in [AUTOMATION.md](./AUTOMATION.md). This file is the short AI-oriented version.

## Standard Workflow

1. Start the dev app:

```bash
pnpm dev:mac   # or pnpm dev:ios
```

2. Get connection info from environment:

- `MATRIX_PORT` — server port
- `MATRIX_TOKEN` — auth token

Or read from `.env.local` in the project root.

3. Construct the base URL:

```
http://127.0.0.1:<MATRIX_PORT>
```

4. Send all bridge requests with:

```text
Authorization: Bearer <MATRIX_TOKEN>
```

5. Recommended request order:

- `GET /bridge/health`
- `GET /bridge/clients`
- `POST /bridge/eval`
- `POST /bridge/event`
- `POST /bridge/reset`
- `POST /bridge/wait`

## Endpoints

### `GET /bridge/health`

Use first. Confirms bridge is running and at least one client is connected.

Expected shape:

```json
{
  "ok": true,
  "clientCount": 1,
  "clients": [
    { "clientId": "macos-main", "platform": "macos", "label": "main" }
  ]
}
```

### `GET /bridge/clients`

List all connected webview clients with metadata.

### `POST /bridge/eval`

Run a JavaScript expression inside the webview and get a JSON-safe result back.

Request:

```json
{
  "script": "document.title",
  "clientId": "macos-main"
}
```

`clientId` is optional — defaults to first connected client.

### `POST /bridge/event`

Dispatch a named automation event into the frontend.

Request:

```json
{
  "name": "automation:seed-session",
  "payload": { "agentId": "codex" }
}
```

### `POST /bridge/reset`

Reset test state. Use before repeating a scenario.

Request:

```json
{
  "scopes": ["web-storage", "automation-state"]
}
```

### `POST /bridge/wait`

Wait for a condition without open-coded polling.

Request:

```json
{
  "condition": "!!document.querySelector('[data-testid=\"add-repo-btn\"]')",
  "timeoutMs": 5000,
  "intervalMs": 100
}
```

Returns `408` on timeout.

## Recommended Agent Prompt

```text
This project exposes an automation bridge on the Matrix server.
Start the app with `pnpm dev:mac`.
Use MATRIX_PORT and MATRIX_TOKEN from .env.local to construct requests.
Base URL: http://127.0.0.1:<MATRIX_PORT>
Send all requests with `Authorization: Bearer <MATRIX_TOKEN>`.
Always begin with `GET /bridge/health` to verify a client is connected.
Use `/bridge/eval` for DOM assertions, `/bridge/event` to trigger frontend hooks,
`/bridge/reset` to reset state, and `/bridge/wait` instead of ad hoc sleeps.
Read `packages/client/AUTOMATION.md` only if more protocol detail is needed.
```

## Notes

- The bridge is available whenever the Matrix server runs and a webview client connects.
- Multi-client support: macOS, iOS, or both simultaneously.
- No discovery files or separate automation ports needed.
