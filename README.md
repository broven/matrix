# Matrix

Remote client for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and other ACP-compatible AI agents. Connect from any device over WebSocket, SSE, or polling.

## Platforms

| Platform | Format | Install |
|---|---|---|
| **macOS** | `.dmg` (Tauri app) | [Download latest release](https://github.com/broven/matrix/releases/latest) |
| **Linux** | Standalone binary + systemd | [Install guide](docs/linux-server.md) |
| **iOS** | `.ipa` via AltStore | Add [AltStore source](https://raw.githubusercontent.com/broven/matrix/main/altstore-source.json) |
| **Docker** | Container image | `docker pull ghcr.io/broven/matrix-server` |

### Linux Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/broven/matrix/main/scripts/install-server.sh | sudo bash
```

See [docs/linux-server.md](docs/linux-server.md) for configuration, updates, and uninstall.

## Architecture

```
packages/
├── protocol/   # Shared TypeScript types (messages, sessions, transports)
├── server/     # Bun + Hono server (ACP bridge, session management, SQLite)
├── sdk/        # Client SDK (WebSocket, SSE, polling transports)
└── client/     # React 19 + Tauri v2 (desktop & mobile)
```

The server spawns agent processes via the [Agent Control Protocol](https://github.com/anthropics/agent-protocol) (ACP) and bridges them to clients over multiple transport modes. Sessions are persistent and recoverable across disconnects.

## Development

```bash
pnpm install
pnpm dev
```

This starts the server, client dev server, and all packages in parallel. Ports are configured in `.env.local`.

## License

[MIT](LICENSE)
