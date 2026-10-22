#!/usr/bin/env bash
set -Eeuo pipefail

# One-command private installation for Ubuntu/Debian. Public ChatGPT account
# enrollment is separate and must authorize the exact target explicitly.
SERVICE_USER=zssh
INSTALL_REF="${ZSSH_REF:-main}"
ENROLL_CODE=""
ENROLL_GATEWAY=""

# Personal commands are generated inside the authenticated ChatGPT plugin.
# Code is deliberately short-lived and single-use: never use an API token here.
while (( $# )); do
  case "$1" in
    --enroll) (( $# >= 2 )) || { echo "missing --enroll value" >&2; exit 2; }; ENROLL_CODE="$2"; shift 2 ;;
    --gateway) (( $# >= 2 )) || { echo "missing --gateway value" >&2; exit 2; }; ENROLL_GATEWAY="$2"; shift 2 ;;
    --ref) (( $# >= 2 )) || { echo "missing --ref value" >&2; exit 2; }; INSTALL_REF="$2"; shift 2 ;;
    --help) break ;;
    *) echo "unknown installer option" >&2; exit 2 ;;
  esac
done

die() { printf 'zSSH install: %s\n' "$*" >&2; exit 2; }

if [[ "${1:-}" == "--help" ]]; then
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
if [[ -n "$ENROLL_CODE" || -n "$ENROLL_GATEWAY" ]]; then
  [[ "$ENROLL_CODE" =~ ^enr_[A-Za-z0-9_-]{43}$ && -n "$ENROLL_GATEWAY" ]] ||
    die "personal VPS enrollment requires a valid --enroll code and --gateway URL"
  [[ "$INSTALL_REF" =~ ^[a-f0-9]{40}$ ]] ||
    die "personal enrollment requires the installer and bootstrap pinned to the same Git SHA"
fi

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
systemctl start "user@${uid}.service"
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
    bootstrap="$(mktemp "${TMPDIR:-/tmp}/zssh-bootstrap.XXXXXXXX")"
    trap '\''rm -f "$bootstrap"'\'' EXIT
    curl --proto "=https" --tlsv1.2 -fsSL \
      https://raw.githubusercontent.com/Zennay/zSSH/"$ZSSH_REF"/deploy/bootstrap-linux.sh \
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

if [[ -n "$ENROLL_CODE" ]]; then
  # Supply the personal code only over stdin. Never write it to disk or place
  # it into the persistent agent environment, systemd unit, or service logs.
  printf '%s\n' "$ENROLL_CODE" | runuser -u "$SERVICE_USER" -- env \
    HOME="$home" \
    FORCE_COLOR=0 \
    node "$home/.local/src/zssh/scripts/enroll-target.mjs" --gateway "$ENROLL_GATEWAY"
  unset ENROLL_CODE

  target_id="$(runuser -u "$SERVICE_USER" -- env HOME="$home" FORCE_COLOR=0 \
    node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME+"/.config/zssh/agent-identity.json", "utf8")).target_id')"
  [[ "$target_id" =~ ^zt_[A-Za-z0-9_-]{8,64}$ ]] || die "invalid agent identity after enrollment"

  # Keep a persistent outbound agent ready for activation after the plugin
  # confirms the exact target fingerprint. It never exposes an inbound port.
  runuser -u "$SERVICE_USER" -- env \
    HOME="$home" \
    XDG_RUNTIME_DIR="$runtime" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" \
    FORCE_COLOR=0 \
    ZSSH_TARGET_ID="$target_id" \
    ZSSH_GATEWAY_URL="$ENROLL_GATEWAY" \
    ZSSH_AGENT_PRIVATE_KEY_FILE="$home/.config/zssh/agent-ed25519.pem" \
    ZSSH_PUBLIC_ALLOWED_ROOTS="$home/zssh-workspace" \
    bash "$home/.local/src/zssh/deploy/install-target-agent.sh" "$home/.local/src/zssh"
  printf '%s\n' "ZSSH_PERSONAL_AGENT_INSTALLED target=$target_id. Secure outbound agent starts on boot and reconnects automatically."
fi

printf '\nZSSH_ONE_COMMAND_INSTALL_GREEN user=%s port=8788 scope=loopback\n' "$SERVICE_USER"
if [[ -n "$ENROLL_GATEWAY" ]]; then
  printf '%s\n' "Target identity registered; the outbound agent remains connected when the short-lived enrollment code expires."
else
  printf '%s\n' "Private loopback gateway installed; personal ChatGPT enrollment was not requested."
fi
printf '%s\n' "No inbound SSH port or reusable ChatGPT token was installed."
