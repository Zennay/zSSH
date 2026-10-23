#!/usr/bin/env bash
set -Eeuo pipefail

# One-command private installation for Ubuntu/Debian. Public ChatGPT account
# enrollment is separate and must authorize the exact target explicitly.
SERVICE_USER=zssh
INSTALL_REF="${ZSSH_REF:-main}"
ENROLL_CODE=""
ENROLL_GATEWAY=""
SERVER_NAME=""
AGENT_EXEC_MODE=""

# Personal commands are generated inside the authenticated ChatGPT plugin.
# Code is deliberately short-lived and single-use: never use an API token here.
while (( $# )); do
  case "$1" in
    --enroll) (( $# >= 2 )) || { echo "missing --enroll value" >&2; exit 2; }; ENROLL_CODE="$2"; shift 2 ;;
    --gateway) (( $# >= 2 )) || { echo "missing --gateway value" >&2; exit 2; }; ENROLL_GATEWAY="$2"; shift 2 ;;
    --ref) (( $# >= 2 )) || { echo "missing --ref value" >&2; exit 2; }; INSTALL_REF="$2"; shift 2 ;;
    --name) (( $# >= 2 )) || { echo "missing --name value" >&2; exit 2; }; SERVER_NAME="$2"; shift 2 ;;
    --allow-shell) AGENT_EXEC_MODE=full; shift ;;
    --no-shell) AGENT_EXEC_MODE=disabled; shift ;;
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

Without --enroll: installs the private loopback-only zSSH gateway under the
unprivileged zssh account, with Node.js, systemd startup, and local health
verification.

With --enroll (the command the zSSH plugin gives you in ChatGPT or Claude):
installs only the outbound agent and links this server to your account.
  --name <name>    name shown in the plugin (default: hostname)
  --allow-shell    let the plugin run shell commands as the zssh user
  --no-shell       turn shell access off again (default)
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
if [[ -n "$SERVER_NAME" ]]; then
  [[ "$SERVER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
    die "--name may only contain letters, digits, dots, dashes and underscores"
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
if [[ -n "$ENROLL_CODE" ]]; then
  # Personal plugin enrollment needs ONLY the outbound agent, not another
  # private gateway. In particular, do not open or take over port 8788.
  runuser -u "$SERVICE_USER" -- env \
    HOME="$home" \
    XDG_RUNTIME_DIR="$runtime" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" \
    FORCE_COLOR=0 \
    ZSSH_REF="$INSTALL_REF" \
    bash -c '
      set -Eeuo pipefail
      umask 077
      source_root="$HOME/.local/src/zssh"
      install -d -m 0700 "$HOME/.local/src" "$HOME/zssh-workspace"
      if [[ -e "$source_root" && ! -d "$source_root/.git" ]]; then
        echo "Refusing to overwrite non-Git zSSH source directory" >&2
        exit 2
      fi
      if [[ ! -d "$source_root/.git" ]]; then
        git clone --no-checkout https://github.com/Zennay/zSSH.git "$source_root"
      else
        remote="$(git -C "$source_root" remote get-url origin)"
        if [[ "${remote%.git}" != "https://github.com/Zennay/zSSH" ]]; then
          echo "Refusing untrusted zSSH source origin" >&2
          exit 2
        fi
      fi
      git -C "$source_root" fetch --depth=1 origin "$ZSSH_REF"
      git -C "$source_root" checkout --force --detach FETCH_HEAD
      if [[ "$(git -C "$source_root" rev-parse HEAD)" != "$ZSSH_REF" ]]; then
        echo "Expected pinned zSSH revision was not checked out" >&2
        exit 2
      fi
    '
else
  # The old no-enrollment command remains a private loopback gateway install.
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
fi

if [[ -n "$ENROLL_CODE" ]]; then
  # Never spend a single-use code when the host already has a conflicting,
  # partially installed, or foreign account-linked target agent.
  existing_agent_env="$home/.config/zssh/agent.env"
  existing_identity="$home/.config/zssh/agent-identity.json"
  existing_private_key="$home/.config/zssh/agent-ed25519.pem"
  if [[ -e "$existing_agent_env" || -e "$existing_identity" || -e "$existing_private_key" ]]; then
    [[ -f "$existing_agent_env" && ! -L "$existing_agent_env" &&
       -f "$existing_identity" && ! -L "$existing_identity" &&
       -f "$existing_private_key" && ! -L "$existing_private_key" ]] ||
      die "Existing target agent state is incomplete or unsafe; refusing enrollment."
    grep -Fxq "ZSSH_GATEWAY_URL=$ENROLL_GATEWAY" "$existing_agent_env" ||
      die "Existing target agent belongs to a different gateway; refusing enrollment."
    configured_target="$(sed -n 's/^ZSSH_TARGET_ID=//p' "$existing_agent_env" | head -n 1)"
    identity_target="$(runuser -u "$SERVICE_USER" -- env HOME="$home" node -e '
      const fs = require("node:fs");
      const data = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/zssh/agent-identity.json", "utf8"));
      process.stdout.write(data.target_id || "");
    ')"
    [[ "$configured_target" =~ ^zt_[A-Za-z0-9_-]{8,64}$ &&
       "$configured_target" == "$identity_target" ]] ||
      die "Existing target agent identity mismatch; refusing enrollment."
  fi
  # Supply the personal code only over stdin. Never write it to disk or place
  # it into the persistent agent environment, systemd unit, or service logs.
  printf '%s\n' "$ENROLL_CODE" | runuser -u "$SERVICE_USER" -- env \
    HOME="$home" \
    FORCE_COLOR=0 \
    node "$home/.local/src/zssh/scripts/enroll-target.mjs" --gateway "$ENROLL_GATEWAY" \
      --name "${SERVER_NAME:-$(hostname -s)}"
  unset ENROLL_CODE

  target_id="$(runuser -u "$SERVICE_USER" -- env HOME="$home" FORCE_COLOR=0 \
    node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME+"/.config/zssh/agent-identity.json", "utf8")).target_id')"
  [[ "$target_id" =~ ^zt_[A-Za-z0-9_-]{8,64}$ ]] || die "invalid agent identity after enrollment"

  # Persistent outbound agent: it dials out to the gateway and never exposes
  # an inbound port. Linked immediately unless the gateway requires approval.
  runuser -u "$SERVICE_USER" -- env \
    HOME="$home" \
    XDG_RUNTIME_DIR="$runtime" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" \
    FORCE_COLOR=0 \
    ZSSH_TARGET_ID="$target_id" \
    ZSSH_GATEWAY_URL="$ENROLL_GATEWAY" \
    ZSSH_AGENT_PRIVATE_KEY_FILE="$home/.config/zssh/agent-ed25519.pem" \
    ZSSH_PUBLIC_ALLOWED_ROOTS="$home/zssh-workspace" \
    ZSSH_EXPECTED_SHA="$INSTALL_REF" \
    ZSSH_AGENT_EXEC_MODE="$AGENT_EXEC_MODE" \
    bash "$home/.local/src/zssh/deploy/install-target-agent.sh" "$home/.local/src/zssh"
  printf '%s\n' "ZSSH_PERSONAL_AGENT_INSTALLED target=$target_id. Secure outbound agent starts on boot and reconnects automatically."
fi

if [[ -n "$ENROLL_GATEWAY" ]]; then
  printf '\nZSSH_ONE_COMMAND_INSTALL_GREEN user=%s mode=outbound-agent-only\n' "$SERVICE_USER"
  printf '%s\n' "Target identity registered; the outbound agent remains connected when the short-lived enrollment code expires."
else
  printf '\nZSSH_ONE_COMMAND_INSTALL_GREEN user=%s port=8788 scope=loopback\n' "$SERVICE_USER"
  printf '%s\n' "Private loopback gateway installed; personal ChatGPT enrollment was not requested."
fi
printf '%s\n' "No inbound SSH port or reusable ChatGPT token was installed."
