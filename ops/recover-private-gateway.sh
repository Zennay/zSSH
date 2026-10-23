#!/usr/bin/env bash
set -Eeuo pipefail

# Recover the existing private zSSH MCP gateway over a regular SSH login.
# Does not install packages, change credentials, alter public OAuth or deploy releases.
MODE="${1:---recover}"
case "$MODE" in
  --recover|--restart|--status) ;;
  *) echo "Usage: bash ops/recover-private-gateway.sh [--recover|--restart|--status]" >&2; exit 2 ;;
esac

if (( EUID == 0 )); then
  echo "Run as the unprivileged zSSH service owner (for example, sudo -iu ubuntu), never root." >&2
  exit 2
fi

ENV_FILE="${ZSSH_ENV_FILE:-$HOME/.config/zssh/gateway.env}"
UNIT="$HOME/.config/systemd/user/zssh.service"
if [[ ! -f "$ENV_FILE" || ! -f "$UNIT" ]]; then
  echo "Existing private zSSH installation not found; nothing was changed." >&2
  exit 2
fi
if grep -Eq '^ZSSH_PLUGIN_PROFILE=public[[:space:]]*$' "$ENV_FILE"; then
  echo "Refusing to recover the public OAuth gateway with the private-service command." >&2
  exit 2
fi
for program in systemctl curl; do
  command -v "$program" >/dev/null 2>&1 || {
    echo "Required command missing: $program" >&2
    exit 2
  }
done

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

health() {
  curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8788/health >/dev/null
}
service_active() {
  systemctl --user is-active --quiet zssh.service
}

if [[ "$MODE" == "--status" ]]; then
  systemctl --user --no-pager --full status zssh.service || true
  if service_active && health; then
    echo "ZSSH_PRIVATE_HEALTHY"
  else
    echo "ZSSH_PRIVATE_UNHEALTHY" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$MODE" == "--recover" ]] && service_active && health; then
  echo "ZSSH_PRIVATE_HEALTHY (already running; no restart needed)"
  exit 0
fi

echo "Restarting the existing private zssh.service (no config or credential changes)"
systemctl --user restart zssh.service
for attempt in {1..12}; do
  if service_active && health; then
    echo "ZSSH_PRIVATE_RECOVERED endpoint=http://127.0.0.1:8788/health"
    exit 0
  fi
  sleep 1
done

echo "zSSH remains unhealthy. Inspect locally with:" >&2
echo "  systemctl --user status zssh.service --no-pager" >&2
echo "  journalctl --user -u zssh.service -n 50 --no-pager" >&2
exit 1
