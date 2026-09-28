#!/usr/bin/env bash
set -Eeuo pipefail

PROFILE="${ZSSH_TUNNEL_PROFILE:-zssh}"
MCP_URL="${ZSSH_MCP_URL:-http://127.0.0.1:8788/mcp}"
TUNNEL_BIN="${ZSSH_TUNNEL_BIN:-$(command -v tunnel-client || true)}"
GATEWAY_ENV="$HOME/.config/zssh/gateway.env"
TUNNEL_ENV="$HOME/.config/zssh/tunnel.env"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/zssh-tunnel.service"

if [[ -z "$TUNNEL_BIN" || ! -x "$TUNNEL_BIN" ]]; then
  echo "tunnel-client is not installed or not in PATH." >&2
  echo "Install the latest release from OpenAI Platform tunnel settings first." >&2
  exit 2
fi
if [[ ! -f "$GATEWAY_ENV" ]]; then
  echo "zSSH gateway config not found: $GATEWAY_ENV" >&2
  echo "Run deploy/bootstrap-vps.sh first." >&2
  exit 2
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for the persistent tunnel service." >&2
  exit 2
fi

TUNNEL_ID="${ZSSH_TUNNEL_ID:-}"
if [[ -z "$TUNNEL_ID" && -t 0 ]]; then
  read -r -p "OpenAI tunnel ID: " TUNNEL_ID
fi
if [[ -z "$TUNNEL_ID" || ! "$TUNNEL_ID" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "Provide a valid ZSSH_TUNNEL_ID." >&2
  exit 2
fi

CONTROL_PLANE_API_KEY="${CONTROL_PLANE_API_KEY:-}"
if [[ -z "$CONTROL_PLANE_API_KEY" && -t 0 ]]; then
  read -r -s -p "OpenAI tunnel runtime API key: " CONTROL_PLANE_API_KEY
  printf '\n' >&2
fi
if [[ -z "$CONTROL_PLANE_API_KEY" || "$CONTROL_PLANE_API_KEY" == *$'\n'* || "$CONTROL_PLANE_API_KEY" == *$'\r'* ]]; then
  echo "Provide CONTROL_PLANE_API_KEY without line breaks." >&2
  exit 2
fi

umask 077
mkdir -p "$(dirname "$TUNNEL_ENV")" "$UNIT_DIR"
printf 'CONTROL_PLANE_API_KEY=%s\n' "$CONTROL_PLANE_API_KEY" > "$TUNNEL_ENV"
chmod 600 "$TUNNEL_ENV"

export CONTROL_PLANE_API_KEY
"$TUNNEL_BIN" init \
  --profile "$PROFILE" \
  --tunnel-id "$TUNNEL_ID" \
  --mcp-server-url "$MCP_URL"
"$TUNNEL_BIN" doctor --profile "$PROFILE" --explain

# The MCP server remains loopback-only. Trusting the local tunnel client avoids
# putting a bearer token into tunnel-client configuration; non-loopback requests
# still require normal authentication.
if grep -q '^ZSSH_TRUST_LOCAL_TUNNEL=' "$GATEWAY_ENV"; then
  sed -i 's/^ZSSH_TRUST_LOCAL_TUNNEL=.*/ZSSH_TRUST_LOCAL_TUNNEL=1/' "$GATEWAY_ENV"
else
  printf 'ZSSH_TRUST_LOCAL_TUNNEL=1\n' >> "$GATEWAY_ENV"
fi
chmod 600 "$GATEWAY_ENV"

cat > "$UNIT" <<EOF
[Unit]
Description=zSSH OpenAI MCP tunnel
After=zssh.service network-online.target
Wants=network-online.target
Requires=zssh.service

[Service]
Type=simple
EnvironmentFile=%h/.config/zssh/tunnel.env
ExecStart=$TUNNEL_BIN run --profile $PROFILE
Restart=always
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=default.target
EOF
chmod 600 "$UNIT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user daemon-reload
systemctl --user enable --now zssh-tunnel.service
systemctl --user --no-pager --full status zssh-tunnel.service || true
printf 'ZSSH_TUNNEL_GREEN profile=%s mcp=%s\n' "$PROFILE" "$MCP_URL"
