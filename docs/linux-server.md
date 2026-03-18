# Linux Server Setup

Install and run Matrix Server on any systemd-based Linux machine.

## Quick Start

```bash
# Install (interactive — prompts for port, auto-generates auth token)
curl -fsSL https://raw.githubusercontent.com/broven/matrix/main/scripts/install-server.sh | sudo bash

# Install (non-interactive)
curl -fsSL https://raw.githubusercontent.com/broven/matrix/main/scripts/install-server.sh | sudo bash -s -- --port 9090 --token my-secret
```

When run interactively without `--token`, the script generates a random auth token and prints it along with the server URL. Save this token — you'll need it to connect clients.

## Update

Re-run the same install command. The script detects the existing installation, downloads the latest binary, and restarts the service. Your configuration is preserved.

```bash
curl -fsSL https://raw.githubusercontent.com/broven/matrix/main/scripts/install-server.sh | sudo bash
```

To change port or token during an update, pass them as arguments:

```bash
curl -fsSL .../install-server.sh | sudo bash -s -- --port 9090 --token new-secret
```

## File Layout

| Path | Purpose |
|---|---|
| `/usr/local/bin/matrix-server` | Server binary |
| `/etc/matrix/config.env` | Configuration (env vars) |
| `/etc/systemd/system/matrix-server.service` | systemd unit file |
| `/var/lib/matrix/` | Data directory (SQLite DB, web assets) |

## Configuration

Edit `/etc/matrix/config.env` and restart the service:

```bash
sudo nano /etc/matrix/config.env
sudo systemctl restart matrix-server
```

| Variable | Default | Description |
|---|---|---|
| `MATRIX_PORT` | `19880` | Listen port |
| `MATRIX_TOKEN` | *(generated)* | Auth token |
| `MATRIX_HOST` | `0.0.0.0` | Bind address |
| `MATRIX_DB_PATH` | `/var/lib/matrix/matrix.db` | SQLite database path |
| `MATRIX_WEB_DIR` | `/var/lib/matrix/web` | Web UI assets directory |

## Managing the Service

```bash
# Check status
systemctl status matrix-server

# View logs
journalctl -u matrix-server -f

# Restart
sudo systemctl restart matrix-server

# Stop
sudo systemctl stop matrix-server
```

## Uninstall

```bash
sudo systemctl disable --now matrix-server
sudo rm /etc/systemd/system/matrix-server.service
sudo systemctl daemon-reload
sudo rm /usr/local/bin/matrix-server
sudo rm -rf /etc/matrix /var/lib/matrix
```

## Requirements

- Linux with systemd (Ubuntu, Debian, Fedora, RHEL, etc.)
- x86_64 or aarch64 (ARM64) architecture
- `curl` or `wget`
- Root access (sudo)
