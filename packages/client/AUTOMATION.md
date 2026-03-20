# Automation Bridge

The automation bridge enables automated testing and verification of the Matrix native client without manual interaction.

## Architecture

The bridge uses a WebSocket-based server-client architecture:

- **Bridge Server** lives in `packages/server` — WebSocket endpoint + HTTP API, all on the existing server port
- **App webviews** connect as WebSocket clients from the browser/Tauri frontend
- **Test runners** interact via HTTP API on the same server (`/bridge/*` endpoints)

## Startup

1. Start the server with `pnpm --filter @matrix/server dev` (or let Tauri spawn it as a sidecar)
2. Start the client with `pnpm --filter @matrix/client tauri:dev`
3. The client's webview automatically connects to the bridge via WebSocket at `/bridge`
4. The client registers as a bridge client (e.g., `macos-main` or `ios-main`)

## Configuration

The bridge uses the same server port and token as the Matrix server:

- `MATRIX_PORT` — server port (set in `.env.local`)
- `MATRIX_TOKEN` — auth token (set in `.env.local`)

No separate automation ports or discovery files are needed.

## HTTP Endpoints

All endpoints require `Authorization: Bearer <token>` header.

- `GET /bridge/health` — bridge status + connected client count
- `GET /bridge/clients` — list connected clients with metadata
- `POST /bridge/eval` — `{ clientId?, script }` — execute JS in webview, returns result
- `POST /bridge/event` — `{ clientId?, name, payload? }` — dispatch event to webview
- `POST /bridge/reset` — `{ clientId?, scopes? }` — reset test state
- `POST /bridge/wait` — `{ clientId?, condition, timeoutMs?, intervalMs? }` — poll eval until truthy

## WebSocket Protocol

Clients connect to `ws://<server>/bridge?token=<token>` and send:

- `{ type: "register", token, platform, label, userAgent? }` — register as a client
- `{ type: "response", requestId, result?, error? }` — respond to server requests
- `{ type: "heartbeat" }` — keep-alive

Server sends to clients:

- `{ type: "eval", requestId, script }` — execute JavaScript
- `{ type: "event", requestId, name, payload? }` — dispatch event
- `{ type: "reset", requestId, scopes? }` — reset test state

## Multi-Client Support

The bridge supports multiple simultaneous clients (e.g., macOS + iOS).
Client IDs are `{platform}-{label}` (e.g., `macos-main`, `ios-main`).
When `clientId` is omitted in HTTP requests, the first connected client is used.

## Troubleshooting

- If no clients are connected, check that the app webview loaded successfully and `shouldInstallBridge()` returns true
- If `/bridge/eval` returns `502`, the target client may have disconnected
- If `/bridge/wait` times out (408), verify the condition against `/bridge/eval` first
- The client auto-reconnects with exponential backoff (1s → 30s) if the WebSocket drops
