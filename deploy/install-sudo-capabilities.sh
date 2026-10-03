#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this scoped capability installer as root." >&2
  exit 2
fi

SERVICE_USER="${ZSSH_SERVICE_USER:-}"
RAW_SERVICES="${ZSSH_SUDO_ALLOWED_SERVICES:-}"
SOURCE_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HELPER_SOURCE="$SOURCE_ROOT/deploy/zssh-sudo-helper"
HELPER_TARGET="/usr/local/libexec/zssh-sudo"
CONFIG_DIR="/etc/zssh"
SERVICES_FILE="$CONFIG_DIR/sudo-services"
SUDOERS_FILE="/etc/sudoers.d/zssh-scoped"

if [[ -z "$SERVICE_USER" || ! "$SERVICE_USER" =~ ^[A-Za-z0-9_.-]{1,64}$ ]]; then
  echo "Set ZSSH_SERVICE_USER to the dedicated Linux service user." >&2
  exit 2
fi
id "$SERVICE_USER" >/dev/null 2>&1 || {
  echo "Unknown ZSSH_SERVICE_USER: $SERVICE_USER" >&2
  exit 2
}
if [[ -z "$RAW_SERVICES" ]]; then
  echo "Set ZSSH_SUDO_ALLOWED_SERVICES to a comma-separated explicit service list." >&2
  exit 2
fi
[[ -f "$HELPER_SOURCE" ]] || {
  echo "Missing helper source: $HELPER_SOURCE" >&2
  exit 2
}

VISUDO="$(command -v visudo || true)"
if [[ -z "$VISUDO" ]]; then
  echo "visudo is required to validate the scoped sudoers rule." >&2
  exit 2
fi

services_tmp="$(mktemp)"
sudoers_tmp="$(mktemp)"
trap 'rm -f "$services_tmp" "$sudoers_tmp"' EXIT

IFS=',' read -r -a services <<< "$RAW_SERVICES"
declare -A seen=()
for raw in "${services[@]}"; do
  service="${raw//[[:space:]]/}"
  [[ -n "$service" ]] || continue
  "$HELPER_SOURCE" validate-name "$service" || {
    echo "Invalid service name: $service" >&2
    exit 2
  }
  if [[ -z "${seen[$service]+x}" ]]; then
    printf '%s\n' "$service" >> "$services_tmp"
    seen["$service"]=1
  fi
done
[[ -s "$services_tmp" ]] || {
  echo "No valid scoped sudo services supplied." >&2
  exit 2
}

/usr/bin/install -d -o root -g root -m 0755 /usr/local/libexec "$CONFIG_DIR"
/usr/bin/install -o root -g root -m 0755 "$HELPER_SOURCE" "$HELPER_TARGET"
/usr/bin/install -o root -g root -m 0644 "$services_tmp" "$SERVICES_FILE"

cat > "$sudoers_tmp" <<EOF
# Managed by zSSH scoped capability installer.
# Root helper performs the argument/service allowlist validation.
$SERVICE_USER ALL=(root) NOPASSWD:NOSETENV: $HELPER_TARGET
EOF
chmod 0440 "$sudoers_tmp"
"$VISUDO" -cf "$sudoers_tmp" >/dev/null
/usr/bin/install -o root -g root -m 0440 "$sudoers_tmp" "$SUDOERS_FILE"
"$VISUDO" -cf "$SUDOERS_FILE" >/dev/null

printf 'ZSSH_SCOPED_SUDO_GREEN user=%s helper=%s services=' "$SERVICE_USER" "$HELPER_TARGET"
paste -sd, "$SERVICES_FILE"
