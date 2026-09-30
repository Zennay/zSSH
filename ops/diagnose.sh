#!/usr/bin/env bash
set -Eeuo pipefail

BASE="${ZSSH_BASE_DIR:-$HOME/.local/share/zssh}"
CURRENT="$BASE/current"
CONFIG="${ZSSH_CONFIG_DIR:-$HOME/.config/zssh}"
ENV_FILE="$CONFIG/gateway.env"
UNIT="$HOME/.config/systemd/user/zssh.service"
PORT="${ZSSH_PORT:-8788}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

echo "=== target identity ==="
id
uname -a
command -v node || true
node --version 2>/dev/null || true
echo

echo "=== zSSH runtime pointers ==="
readlink -f "$CURRENT" 2>/dev/null || true
ls -ld "$BASE" "$CURRENT" 2>/dev/null || true
ls -l "$UNIT" 2>/dev/null || true
stat -c '%a %U:%G %n' "$ENV_FILE" 2>/dev/null || true
if [[ -f "$ENV_FILE" ]]; then
  echo "configured keys:"
  cut -d= -f1 "$ENV_FILE" | sed '/^$/d' | sort
  grep -E '^(ZSSH_TARGET_NAME|ZSSH_ALLOWED_ROOTS|ZSSH_EXEC_MODE)=' "$ENV_FILE" || true
fi
echo

echo "=== zSSH user service ==="
systemctl --user status zssh.service --no-pager -l || true
echo
journalctl --user -u zssh.service -n 120 --no-pager || true
echo

echo "=== zSSH health ==="
curl -fsS "http://127.0.0.1:$PORT/health" || true
echo
