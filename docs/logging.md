# Logging

Matrix uses structured logging across all layers. Logs from the client, server, and Tauri shell merge into a unified timeline for easier debugging.

## Log File Locations

| Platform | Component | Location |
|----------|-----------|----------|
| Mac (Tauri) | Client + Server (merged) | `~/Library/Logs/com.matrix.client/` |
| Linux | Server (standalone) | `~/.matrix/logs/matrix.log` |
| Linux (systemd) | Server | `journalctl -u matrix-server -f` |

## Viewing Logs

### Mac

```bash
# Real-time tail
tail -f ~/Library/Logs/com.matrix.client/*.log

# macOS Console app
open -a Console ~/Library/Logs/com.matrix.client/
```

On Mac, the server runs as a Tauri sidecar. Its structured JSON output is captured by the Tauri shell, parsed, and forwarded through `tauri-plugin-log` into the same log file as the client. This means you get a single chronological stream of all activity.

### Linux (standalone server)

```bash
# Real-time tail (raw JSON)
tail -f ~/.matrix/logs/matrix.log

# Pretty-print with jq
tail -f ~/.matrix/logs/matrix.log | jq .

# Filter by session
cat ~/.matrix/logs/matrix.log | jq 'select(.sessionId == "sess_xxx")'

# Only errors (level >= 50)
cat ~/.matrix/logs/matrix.log | jq 'select(.level >= 50)'

# Only warnings and above
cat ~/.matrix/logs/matrix.log | jq 'select(.level >= 40)'

# Filter by module
cat ~/.matrix/logs/matrix.log | jq 'select(.target == "acp-bridge")'
```

### Linux (systemd service)

```bash
# Follow logs
journalctl -u matrix-server -f

# Last 100 lines
journalctl -u matrix-server -n 100

# Since last hour
journalctl -u matrix-server --since "1 hour ago"

# Only errors
journalctl -u matrix-server -p err
```

## Log Levels

| Level | Pino Value | When to Use |
|-------|-----------|-------------|
| trace | 10 | Extremely detailed tracing |
| debug | 20 | Development diagnostics |
| info  | 30 | Normal operations (session created, agent spawned) |
| warn  | 40 | Recoverable issues (discovery fallback, branch delete failed) |
| error | 50 | Failures (agent crash, spawn failed) |
| fatal | 60 | Unrecoverable errors |

Default levels:
- **Development**: `debug`
- **Production**: `info`

### Changing Log Level

```bash
# Temporarily increase verbosity
MATRIX_LOG_LEVEL=trace bun run start

# Reduce noise
MATRIX_LOG_LEVEL=warn bun run start
```

For the systemd service, add `MATRIX_LOG_LEVEL=debug` to `/etc/matrix/config.env` and restart.

## Log Rotation

| Platform | Strategy | Max Size | Retention |
|----------|----------|----------|-----------|
| Mac (tauri-plugin-log) | KeepOne | 10 MB | Current + 1 rotated file |
| Linux (pino-roll) | Count-based | 10 MB | 5 files max |

Rotation happens automatically when a log file reaches 10 MB.

## Log Format

### Server (pino JSON)

In standalone mode, logs are written as newline-delimited JSON:

```json
{"level":30,"time":1711100000000,"target":"server","sessionId":"sess_abc123","msg":"session update"}
{"level":50,"time":1711100001000,"target":"acp-bridge","err":{"message":"spawn failed"},"msg":"agent error"}
```

### Mac (tauri-plugin-log)

In the Tauri log file, server JSON is forwarded as-is at the appropriate level, alongside client and Rust-native log entries:

```
2026-03-22T10:30:15.123Z [INFO] [sidecar] {"level":30,"time":...,"msg":"Matrix Server started"}
2026-03-22T10:30:15.200Z [DEBUG] [client] bridge-ws connected
```

## Architecture

```
Mac (Tauri sidecar mode):
┌───────────┐  plugin-log JS   ┌──────────────┐
│  Client    │ ───────────────→ │  Tauri        │
│  (React)   │                  │  tauri-plugin │──→ ~/Library/Logs/
└───────────┘                  │  -log         │    com.matrix.client/
┌───────────┐  stdout JSON      │              │
│  Server    │ ───────────────→ │  tracing      │
│  (pino)    │                  └──────────────┘
└───────────┘

Linux (standalone mode):
┌───────────┐  pino-roll
│  Server    │ ──────────→ ~/.matrix/logs/matrix.log
│  (pino)    │
└───────────┘
```

## Troubleshooting

**No log file on Mac?**
Check `~/Library/Logs/com.matrix.client/`. The directory is created on first app launch.

**No log file on Linux?**
Check `~/.matrix/logs/`. The directory is created automatically on server start. If running as a systemd service, the user is `root`, so logs go to `/root/.matrix/logs/` unless `MATRIX_DATA_DIR` is configured.

**Logs too verbose?**
Set `MATRIX_LOG_LEVEL=info` or `MATRIX_LOG_LEVEL=warn`.

**Need to debug a specific session?**
Filter by sessionId: `cat ~/.matrix/logs/matrix.log | jq 'select(.sessionId == "sess_xxx")'`
