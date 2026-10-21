#!/usr/bin/env bash
set -Eeuo pipefail

# One-command private installation for Ubuntu/Debian. Public ChatGPT account
# enrollment is separate and must authorize the exact target explicitly.
SERVICE_USER=zssh
INSTALL_REF="\${ZSSH_REF:-main}"

die() { printf 'zSSH install: %s\n' "$*" >&2; exit 2; }

if [[ "\${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage:
  curl -fsSL https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/install.sh | sudo bash

Optional: ZSSH_REF=<40-character-commit-sha> sudo -E bash deploy/install.sh

Installs the private loopback-only zSSH gateway under the unprivileged
zssh account, with Node.js, systemd startup, and local health verification.
Plugin account enrollment is not currently provisioned by this command.
HELP
  exit 0
fi

[[ "$(id -u)" == 0 ]] || die "Run as root (e.g. pipe to sudo bash)."
[[ "$(uname -s)" == Linux ]] || die "Only Linux is supported."
command -v apt-get >/dev/null 2>&1 || die "Automatic system package setup requires Ubuntu/Debian (apt-get)."
command -v systemctl >/dev/null 2>&1 || die "systemd is required."
[[ "$INSTALL_REF" == "main" || "$INSTALL_REF" =~ ^[a-f0-9]{40}$ ]] ||
  die "ZSSH_REF must be main or an exact 40-character Git commit SHA."

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git sudo openssl dbus-user-session

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(FORCE_COLOR=0 node -p 'Number(process.versions.node.split(".")[0])')"
fi
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
  setup="$(mktemp /tmp/zssh-nodesource.XXXXXXXX)"
  trap 'rm -f "$setup"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://deb.nodesource.com/setup_22.x -o "$setup"
  bash "$setup"
  apt-get install -y --no-install-recommends nodejs
  rm -f "$setup"
  trap - EXIT
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --user-group --shell /bin/bash "$SERVICE_USER"
fi
uid="$(id -u "$SERVICE_USER")"
(( uid > 0 )) || die "Refusing to run the service as root."
home="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
[[ -n "$home" && -d "$home" ]] || die "Service user needs a real home directory."

loginctl enable-linger "$SERVICE_USER"
systemctl start "user@\${uid}.service"
runtime="/run/user/$uid"
[[ -S "$runtime/bus" ]] || die "systemd user bus is unavailable for $SERVICE_USER."

printf 'zSSH: installing under unprivileged user %s\n' "$SERVICE_USER"
runuser -u "$SERVICE_USER" -- env \
  HOME="$home" \
  XDG_RUNTIME_DIR="$runtime" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" \
  FORCE_COLOR=0 \
  ZSSH_REF="$INSTALL_REF" \
  bash -c '
    set -Eeuo pipefail
    umask 077
    bootstrap="$(mktemp "\${TMPDIR:-/tmp}/zssh-bootstrap.XXXXXXXX")"
    trap '\''rm -f "$bootstrap"'\'' EXIT
    curl --proto "=https" --tlsv1.2 -fsSL \
      https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/bootstrap-linux.sh \
      -o "$bootstrap"
    bash "$bootstrap"
  '

runuser -u "$SERVICE_USER" -- env \
  HOME="$home" \
  XDG_RUNTIME_DIR="$runtime" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" \
  systemctl --user is-active --quiet zssh.service ||
  die "zssh.service did not become active."
curl --fail --silent --show-error http://127.0.0.1:8788/health ||
  die "Local zSSH health check failed."

printf '\nZSSH_ONE_COMMAND_INSTALL_GREEN user=%s port=8788 scope=loopback\n' "$SERVICE_USER"
printf '%s\n' \
  "Installed and running. Public ChatGPT account/agent enrollment is NOT configured." \
  "No SSH key, reusable token, public port, or third-party access was enabled."
