# Linux Server Install Script Design

## Goal

Provide a single shell script that installs and manages the Matrix server on bare-metal Linux (systemd-based). One command for both first-time install and subsequent updates.

## Context

Matrix server is a Bun-based binary (`matrix-server`) distributed via GitHub Releases. It accepts configuration through CLI args and environment variables (`MATRIX_PORT`, `MATRIX_TOKEN`, `MATRIX_HOST`, `MATRIX_DB_PATH`). When `MATRIX_TOKEN` is not set, a random token is generated on each startup — which breaks client connections after restarts.

The install script solves three problems:
1. Download and place the binary
2. Persist configuration (port, token) across restarts
3. Run as a daemon with automatic restart on failure

## User Experience

```bash
# First install (interactive — prompts for port and token)
curl -fsSL https://raw.githubusercontent.com/.../install-server.sh | bash

# First install (non-interactive)
curl -fsSL .../install-server.sh | bash -s -- --port 9090 --token my-secret

# Update binary (re-run the same command, config is preserved)
curl -fsSL .../install-server.sh | bash
```

## File Layout

```
/usr/local/bin/matrix-server                # binary
/etc/matrix/config.env                      # persistent configuration
/etc/systemd/system/matrix-server.service   # systemd unit
/var/lib/matrix/                            # data directory (SQLite DB)
```

## Script Logic

### Mode Detection

The script auto-detects install vs update:

```
if /usr/local/bin/matrix-server exists:
    → update mode (download binary, restart service, skip config)
else:
    → install mode (full setup)
```

### Install Mode

1. **Preflight checks**
   - Must run as root (or with sudo)
   - `systemctl` must exist
   - `curl` or `wget` must exist
   - Detect CPU architecture: `x86_64` → `amd64`, `aarch64` → `arm64`

2. **Download binary**
   - Fetch latest release tag from GitHub API: `GET /repos/{owner}/{repo}/releases/latest`
   - Download `matrix-server-linux-{arch}` from release assets
   - Place at `/usr/local/bin/matrix-server`, chmod 755

3. **Configure**
   - If `--port` provided, use it; otherwise prompt interactively (default: 8080)
   - If `--token` provided, use it; otherwise generate a random 48-char token
   - Create `/etc/matrix/config.env`:
     ```bash
     MATRIX_PORT=8080
     MATRIX_TOKEN=<generated-or-provided>
     MATRIX_DB_PATH=/var/lib/matrix/matrix.db
     ```
   - Create `/var/lib/matrix/` directory

4. **Install systemd service**
   - Write `/etc/systemd/system/matrix-server.service`:
     ```ini
     [Unit]
     Description=Matrix Server
     After=network.target

     [Service]
     Type=simple
     EnvironmentFile=/etc/matrix/config.env
     ExecStart=/usr/local/bin/matrix-server --port ${MATRIX_PORT}
     Restart=on-failure
     RestartSec=5

     [Install]
     WantedBy=multi-user.target
     ```
   - `systemctl daemon-reload`
   - `systemctl enable --now matrix-server`

5. **Print connection info**
   - Server URL, token, and connection URI
   - Hint to check status: `systemctl status matrix-server`

### Update Mode

1. **Preflight checks** (same as install)
2. **Version check**
   - Get installed version: `matrix-server --version`
   - Get latest version from GitHub API
   - If same, print "already up to date" and exit
3. **Download new binary** (same download logic)
4. **Restart service**
   - `systemctl restart matrix-server`
5. **Print update result** (old version → new version)

Config file is never touched during update.

## Configuration

`/etc/matrix/config.env` uses shell variable format, loaded by systemd `EnvironmentFile`:

| Variable | Default | Description |
|---|---|---|
| `MATRIX_PORT` | `8080` | Listen port |
| `MATRIX_TOKEN` | (generated) | Auth token |
| `MATRIX_HOST` | `0.0.0.0` | Bind address |
| `MATRIX_DB_PATH` | `/var/lib/matrix/matrix.db` | SQLite database path |

Users edit this file directly to change configuration, then `systemctl restart matrix-server`.

## Uninstall

Not automated — documented in README as manual steps:

```bash
systemctl disable --now matrix-server
rm /etc/systemd/system/matrix-server.service
systemctl daemon-reload
rm /usr/local/bin/matrix-server
rm -rf /etc/matrix /var/lib/matrix
```

## Repository Files

| File | Purpose |
|---|---|
| `scripts/install-server.sh` | Install/update script |
| `docs/linux-server.md` | User-facing README |

## Non-Goals

- No Docker support in this script (Dockerfile already exists)
- No multi-user / permission separation (runs as root for simplicity)
- No built-in TLS termination (use a reverse proxy)
- No uninstall command (documented manual steps are sufficient)
