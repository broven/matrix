#!/usr/bin/env bash
set -euo pipefail

REPO="broven/matrix"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="matrix-server"
CONFIG_DIR="/etc/matrix"
CONFIG_FILE="${CONFIG_DIR}/config.env"
DATA_DIR="/var/lib/matrix"
SERVICE_NAME="matrix-server"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# --- Helpers ---

info()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }
fatal() { err "$@"; exit 1; }

download() {
  local url=$1 dest=$2
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    fatal "Neither curl nor wget found"
  fi
}

fetch() {
  local url=$1
  if command -v curl &>/dev/null; then
    curl -fsSL "$url"
  elif command -v wget &>/dev/null; then
    wget -qO- "$url"
  else
    fatal "Neither curl nor wget found"
  fi
}

generate_token() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 24
  elif [ -r /dev/urandom ]; then
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    fatal "Cannot generate random token (no openssl or /dev/urandom)"
  fi
}

# --- Preflight ---

preflight() {
  if [ "$(id -u)" -ne 0 ]; then
    fatal "This script must be run as root (use sudo)"
  fi

  if ! command -v systemctl &>/dev/null; then
    fatal "systemctl not found — this script requires systemd"
  fi

  if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    fatal "Either curl or wget is required"
  fi

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH_LABEL="x64" ;;
    aarch64) ARCH_LABEL="arm64" ;;
    *)       fatal "Unsupported architecture: $ARCH" ;;
  esac
}

# --- GitHub Release ---

get_latest_version() {
  local channel=$1
  local response

  if [ "$channel" = "beta" ]; then
    # Fetch all releases, find the highest semver (not just first in list)
    local api_url="https://api.github.com/repos/${REPO}/releases?per_page=20"
    response=$(fetch "$api_url") || fatal "Failed to fetch releases from GitHub"
    # Extract all tag_names, then pick the highest via sort -V
    local best
    best=$(echo "$response" | grep -o '"tag_name":\s*"[^"]*"' | cut -d'"' -f4 | sort -V | tail -1)
    echo "$best"
  else
    # Stable: fetch latest
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    response=$(fetch "$api_url") || fatal "Failed to fetch latest release from GitHub"
    echo "$response" | grep -o '"tag_name":\s*"[^"]*"' | head -1 | cut -d'"' -f4
  fi
}

download_binary() {
  local version=$1
  local version_no_v="${version#v}"
  local tarball_name="matrix-server-v${version_no_v}-linux-${ARCH_LABEL}.tar.gz"
  local download_url="https://github.com/${REPO}/releases/download/${version}/${tarball_name}"

  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT

  info "Downloading ${tarball_name}..."
  download "$download_url" "${tmpdir}/${tarball_name}"

  info "Extracting..."
  tar xzf "${tmpdir}/${tarball_name}" -C "$tmpdir"

  # Find the binary inside the extracted directory
  local extracted_dir="${tmpdir}/matrix-server-v${version_no_v}-linux-${ARCH_LABEL}"
  if [ ! -f "${extracted_dir}/${BINARY_NAME}" ]; then
    fatal "Binary not found in tarball"
  fi

  cp "${extracted_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod 755 "${INSTALL_DIR}/${BINARY_NAME}"

  # Copy web assets if present
  if [ -d "${extracted_dir}/web" ]; then
    mkdir -p "${DATA_DIR}/web"
    cp -r "${extracted_dir}/web/"* "${DATA_DIR}/web/"
  fi

  ok "Installed ${BINARY_NAME} ${version} to ${INSTALL_DIR}/${BINARY_NAME}"
}

# --- Configure ---

configure() {
  local port=$1 token=$2

  mkdir -p "$CONFIG_DIR" "$DATA_DIR"

  # Create dedicated system user
  if ! id -u matrix &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin matrix
    info "Created system user: matrix"
  fi

  chown -R matrix:matrix "$DATA_DIR"

  cat > "$CONFIG_FILE" <<EOF
MATRIX_PORT="${port}"
MATRIX_TOKEN="${token}"
MATRIX_HOST="0.0.0.0"
MATRIX_DB_PATH="${DATA_DIR}/matrix.db"
MATRIX_WEB_DIR="${DATA_DIR}/web"
UPDATE_CHANNEL="${CHANNEL}"
EOF

  chmod 600 "$CONFIG_FILE"
  ok "Configuration written to ${CONFIG_FILE}"
}

# --- Systemd ---

install_service() {
  cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Matrix Server
After=network.target

[Service]
Type=simple
User=matrix
Group=matrix
EnvironmentFile=/etc/matrix/config.env
ExecStart=/usr/local/bin/matrix-server --port ${MATRIX_PORT} --web ${MATRIX_WEB_DIR}
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/matrix

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  ok "Service installed and started"
}

# --- Parse Args ---

parse_args() {
  PORT=""
  TOKEN=""
  CHANNEL=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port)
        [ $# -ge 2 ] || fatal "--port requires a value"
        PORT="$2"
        [[ "$PORT" =~ ^[0-9]+$ ]] || fatal "--port must be a number, got: ${PORT}"
        shift 2
        ;;
      --token)
        [ $# -ge 2 ] || fatal "--token requires a value"
        TOKEN="$2"
        shift 2
        ;;
      --channel)
        [ $# -ge 2 ] || fatal "--channel requires a value"
        CHANNEL="$2"
        [[ "$CHANNEL" =~ ^(stable|beta)$ ]] || fatal "--channel must be 'stable' or 'beta', got: ${CHANNEL}"
        shift 2
        ;;
      *)
        fatal "Unknown option: $1"
        ;;
    esac
  done
}

# --- Main ---

main() {
  parse_args "$@"
  preflight

  # Resolve channel: CLI arg > config file > default
  if [ -z "$CHANNEL" ] && [ -f "$CONFIG_FILE" ]; then
    CHANNEL=$(grep -oP '^UPDATE_CHANNEL="\K[^"]+' "$CONFIG_FILE" 2>/dev/null || true)
  fi
  CHANNEL="${CHANNEL:-stable}"
  info "Update channel: ${CHANNEL}"

  local latest_version
  latest_version=$(get_latest_version "$CHANNEL")
  [ -z "$latest_version" ] && fatal "Could not determine latest version"

  if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
    # --- Update mode ---
    info "Existing installation detected — updating..."

    download_binary "$latest_version"

    # Update config if --port, --token, or --channel was provided
    local config_changed=""
    if [ -n "$PORT" ] && [ -f "$CONFIG_FILE" ]; then
      sed -i "s/^MATRIX_PORT=.*/MATRIX_PORT=\"${PORT}\"/" "$CONFIG_FILE"
      ok "Updated port to ${PORT}"
      config_changed=1
    fi
    if [ -n "$TOKEN" ] && [ -f "$CONFIG_FILE" ]; then
      sed -i "s/^MATRIX_TOKEN=.*/MATRIX_TOKEN=\"${TOKEN}\"/" "$CONFIG_FILE"
      ok "Updated token"
      config_changed=1
    fi
    if [ -n "$CHANNEL" ] && [ -f "$CONFIG_FILE" ]; then
      if grep -q '^UPDATE_CHANNEL=' "$CONFIG_FILE" 2>/dev/null; then
        sed -i "s/^UPDATE_CHANNEL=.*/UPDATE_CHANNEL=\"${CHANNEL}\"/" "$CONFIG_FILE"
      else
        echo "UPDATE_CHANNEL=\"${CHANNEL}\"" >> "$CONFIG_FILE"
      fi
      ok "Updated channel to ${CHANNEL}"
      config_changed=1
    fi

    systemctl restart "$SERVICE_NAME"
    ok "Updated to ${latest_version}"
    [ -n "$config_changed" ] && ok "Configuration updated"
    echo
    info "Check status: systemctl status ${SERVICE_NAME}"
  else
    # --- Install mode ---
    info "Installing Matrix Server..."

    download_binary "$latest_version"

    # Determine port
    if [ -z "$PORT" ]; then
      if [ -t 0 ]; then
        printf 'Port [8080]: '
        read -r PORT
      fi
      PORT="${PORT:-8080}"
    fi

    # Determine token
    if [ -z "$TOKEN" ]; then
      TOKEN=$(generate_token)
      info "Generated auth token (save this): ${TOKEN}"
    fi

    configure "$PORT" "$TOKEN"
    install_service

    echo
    ok "Matrix Server is running!"
    echo
    echo "  URL:    http://$(hostname -f 2>/dev/null || hostname):${PORT}"
    echo "  Token:  ${TOKEN}"
    echo
    info "Check status: systemctl status ${SERVICE_NAME}"
    info "View logs:    journalctl -u ${SERVICE_NAME} -f"
    info "Edit config:  ${CONFIG_FILE}"
  fi
}

main "$@"
