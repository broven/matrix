# Unified Logging System Design

## Problem

Current logging is ad-hoc: `console.log/error` on JS side, `eprintln!` on Rust side. No log levels, no persistence, no rotation, no structured output. Debugging issues — especially from user bug reports — is painful.

## Architecture

```
Mac (Tauri sidecar mode):
┌───────────┐  JS binding   ┌───────────────┐
│  Client    │ ────────────→ │  Tauri         │
│  (React)   │               │  tauri-plugin  │──→ ~/Library/Logs/
└───────────┘               │  -log          │    com.matrix.app/
┌───────────┐  stdout JSON   │               │
│  Server    │ ────────────→ │  tracing       │
│  (pino)    │               └───────────────┘
└───────────┘

Linux (standalone mode):
┌───────────┐  pino-roll
│  Server    │ ──────────→ ~/.matrix/logs/matrix.log
│  (pino)    │
└───────────┘
```

All logs merge into a single timeline per platform.

## Components

### 1. Rust / Tauri — `tauri-plugin-log`

- Add `tauri-plugin-log` to Cargo.toml and plugin registration
- Configure: rotation 5 files × 10MB, format with timestamp + level + target
- Dev mode default `debug`, release default `info`, override via `MATRIX_LOG_LEVEL`
- Parse sidecar stdout JSON, extract level/msg/fields, forward to `tracing`

### 2. Server (Bun) — `pino` + `pino-roll`

- Add `pino` and `pino-roll` dependencies
- Create `packages/server/src/logger.ts`:

```typescript
import pino from 'pino'

const isSidecar = !!process.env.TAURI_SIDECAR

export const logger = pino({
  level: process.env.MATRIX_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: isSidecar
    ? undefined // default: JSON to stdout → Rust captures
    : { target: 'pino-roll', options: { file: '~/.matrix/logs/matrix.log', size: '10m', limit: { count: 5 } } }
})
```

- Replace all `console.log/error/warn` with `logger.info/error/warn`
- Remove `/tmp/matrix-bridge.log` debug logging
- Use child loggers for context: `logger.child({ sessionId, target: 'server:session' })`

### 3. Client (React) — `@tauri-apps/plugin-log`

- Add `@tauri-apps/plugin-log` dependency
- Create `packages/client/src/lib/logger.ts`:

```typescript
import { info, error, warn, debug } from '@tauri-apps/plugin-log'

export const logger = {
  info: (msg: string) => { info(msg); if (import.meta.env.DEV) console.info(msg) },
  error: (msg: string) => { error(msg); if (import.meta.env.DEV) console.error(msg) },
  warn: (msg: string) => { warn(msg); if (import.meta.env.DEV) console.warn(msg) },
  debug: (msg: string) => { debug(msg); if (import.meta.env.DEV) console.debug(msg) },
}
```

- Replace key `console.log/error` calls with `logger.*`
- Dev mode: dual output (plugin-log + DevTools console)

## Log Format

Server (pino JSON to stdout):
```json
{"level":30,"time":1711100000000,"target":"server:session","msg":"session created","sessionId":"abc123"}
```

File output (tauri-plugin-log / pino-roll):
```
2026-03-22T10:30:15.123Z [INFO] [server::session] session created sessionId=abc123
```

## Rotation & Storage

| Platform | Location | Max Files | Max Size/File |
|----------|----------|-----------|---------------|
| Mac | `~/Library/Logs/com.matrix.app/` | 5 | 10MB |
| Linux | `~/.matrix/logs/` | 5 | 10MB |

## Log Levels

| Environment | Default | Override |
|-------------|---------|---------|
| Development | `debug` | `MATRIX_LOG_LEVEL=trace` |
| Production  | `info`  | `MATRIX_LOG_LEVEL=debug` |

## Sidecar Mode Detection

Server detects whether it runs as a Tauri sidecar or standalone via `process.env.TAURI_SIDECAR`. Tauri sets this env var when spawning the sidecar process.

## Implementation Scope

1. **Rust** — add `tauri-plugin-log`, configure rotation + levels, parse sidecar JSON → tracing
2. **Server** — add `pino` + `pino-roll`, create `logger.ts`, replace all console.* calls, remove `/tmp` debug log
3. **Client** — add `@tauri-apps/plugin-log`, create `logger.ts` wrapper, replace key console.* calls
