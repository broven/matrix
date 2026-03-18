# Automation Bridge

`packages/client` contains the development-only automation bridge used to verify the native client without manual app releases.

## Startup

- Start the client in development mode with `pnpm --filter @matrix/client tauri:dev`.
- The bridge is enabled only in dev/test builds.
- On desktop, startup writes a discovery file and prints the bridge base URL to stdout.
- The bridge listens on loopback only and uses a bearer token for every request.

## Discovery

The bridge writes `automation.json` to the dev discovery directory.

Default location on macOS and iOS simulator hosts:

- `~/Library/Application Support/Matrix/dev/automation.json`

The file is written atomically and has this shape:

```json
{
  "enabled": true,
  "platform": "macos",
  "baseUrl": "http://127.0.0.1:18765",
  "token": "dev-...",
  "pid": 12345
}
```

Notes:

- `enabled` is always `true` for a running dev bridge.
- `platform` is the runtime platform name reported by the app.
- `baseUrl` is the HTTP loopback address for the bridge.
- `token` is required in the `Authorization: Bearer ...` header.
- `pid` is the current app process id.

## Endpoints

The current bridge exposes these endpoints:

- `GET /health`
- `GET /state`
- `POST /webview/eval`
- `POST /webview/event`
- `POST /native/invoke`
- `POST /test/reset`
- `POST /wait`

Response errors use stable string codes such as `unauthorized`, `invalid_json`, `unsupported_action`, `unsupported_condition`, `timeout`, `webview_unavailable`, `native_unavailable`, `reset_failed`, and `internal_error`.

## Capability Matrix

The protocol is shared across desktop and iOS simulator, but platform support differs.

| Capability | Desktop | iOS simulator |
| --- | --- | --- |
| `GET /health` | Supported | Supported by the shared contract |
| `GET /state` | Supported | Supported by the shared contract |
| `POST /webview/eval` | Supported | Supported by the shared contract |
| `POST /webview/event` | Supported | Supported by the shared contract |
| `POST /native/invoke` | Supported for `window.focus`, `window.reload`, and `sidecar.status` | Adapter exists in code, but the live startup path is desktop-first; desktop-only actions should return `unsupported_action` when routed through the shared contract |
| `POST /test/reset` | Supported | Supported by the shared contract |
| `POST /wait` | Supported | Supported by the shared contract |

Desktop state includes window and sidecar metadata. iOS simulator state does not have a sidecar and should report that as unavailable.

The iOS simulator adapter is present in `packages/client/src-tauri/src/automation/runtime/ios_sim.rs`, but the current dev startup wiring still boots the desktop bridge path.

## Troubleshooting

- If the bridge does not start, check the app console for `Automation bridge failed to start`.
- If discovery is missing, confirm the app is running in dev/test mode and that `MATRIX_AUTOMATION_DISCOVERY_DIR` is writable when overridden.
- If requests return `401`, make sure the `Authorization` header uses the token from `automation.json`.
- If `/webview/eval` returns `webview_unavailable`, the frontend bridge was not installed or did not respond in time.
- If `/native/invoke` returns `unsupported_action`, the requested action is not part of the current whitelist.
- If `/wait` times out, verify the condition against `/state` or `webview.eval` first.
