#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"
SOURCE="$SOURCE_ROOT"

if [[ ! -f "$SOURCE/server.mjs" || ! -f "$SOURCE/package.json" ]]; then
  echo "zSSH source tree is incomplete: $SOURCE" >&2
  exit 2
fi

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to install zSSH as root; run as the dedicated target user." >&2
  exit 2
fi

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "Node.js and npm are required" >&2
  exit 2
fi
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js >=20 required; found $("$NODE_BIN" --version)" >&2
  exit 2
fi

REPO_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ -z "$REPO_SHA" ]]; then
  echo "Source root must be a Git checkout" >&2
  exit 2
fi
if [[ -n "${ZSSH_EXPECTED_SHA:-}" && "$REPO_SHA" != "$ZSSH_EXPECTED_SHA" ]]; then
  echo "Refusing unexpected zSSH revision: expected $ZSSH_EXPECTED_SHA got $REPO_SHA" >&2
  exit 2
fi

BASE="$HOME/.local/share/zssh"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
STATE="$HOME/.local/state/zssh"
CONFIG="$HOME/.config/zssh"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/zssh.service"
ENV_FILE="$CONFIG/gateway.env"
RELEASE="$RELEASES/$REPO_SHA"
STAGE="$RELEASES/.$REPO_SHA.stage.$$"

mkdir -p "$RELEASES" "$STATE" "$CONFIG" "$UNIT_DIR"
chmod 700 "$STATE" "$CONFIG"
trap 'rm -rf "$STAGE"' EXIT

if [[ ! -d "$RELEASE" ]]; then
  mkdir -p "$STAGE"
  cp -a "$SOURCE/." "$STAGE/"
  rm -rf "$STAGE/node_modules" "$STAGE/data"
  "$NPM_BIN" install --prefix "$STAGE" --omit=dev --ignore-scripts --no-audit --no-fund
  "$NPM_BIN" test --prefix "$STAGE"
  mv "$STAGE" "$RELEASE"
fi

random_hex_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    "$NODE_BIN" -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
  fi
}

FRESH_CONFIG=0
if [[ ! -f "$ENV_FILE" ]]; then
  FRESH_CONFIG=1
  if [[ -n "${ZSSH_ALLOWED_ROOTS:-}" ]]; then
    ALLOWED_ROOTS="$ZSSH_ALLOWED_ROOTS"
  elif [[ -d "$HOME/zennay-cloud" ]]; then
    # Preserve the original single-VPS default for existing zCloud hosts.
    ALLOWED_ROOTS="$HOME/zennay-cloud"
  else
    # New generic installs get a dedicated, least-surprise workspace.
    ALLOWED_ROOTS="$HOME/zssh-workspace"
    mkdir -p "$ALLOWED_ROOTS"
  fi
  TARGET_NAME="${ZSSH_TARGET_NAME:-$(hostname 2>/dev/null || uname -n)}"
  TARGET_ID="${ZSSH_TARGET_ID:-target_$(random_hex_32)}"
  PROFILE="${ZSSH_PROFILE:-plugin}"
  PUBLIC_URL="${ZSSH_PUBLIC_URL:-}"
  ALLOWED_SERVICES="${ZSSH_ALLOWED_SERVICES:-}"
  CLIENT_TOKENS_FILE="$CONFIG/clients.json"
  AUDIT_PATH="${ZSSH_AUDIT_LOG:-$HOME/.local/state/zssh/audit.jsonl}"
  if [[ "$ALLOWED_ROOTS" == *
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_ID=$TARGET_ID
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_PROFILE=$PROFILE
ZSSH_PUBLIC_URL=$PUBLIC_URL
ZSSH_CLIENT_TOKENS_FILE=$CLIENT_TOKENS_FILE
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_ALLOWED_SERVICES=$ALLOWED_SERVICES
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_TARGET_ID=' "$ENV_FILE"; then
  printf '\nZSSH_TARGET_ID=target_%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_PROFILE=' "$ENV_FILE"; then
  printf '\nZSSH_PROFILE=private\n' >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_PUBLIC_URL=' "$ENV_FILE"; then
  printf '\nZSSH_PUBLIC_URL=\n' >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_CLIENT_TOKENS_FILE=' "$ENV_FILE"; then
  printf '\nZSSH_CLIENT_TOKENS_FILE=%s\n' "$CONFIG/clients.json" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_ALLOWED_SERVICES=' "$ENV_FILE"; then
  printf '\nZSSH_ALLOWED_SERVICES=\n' >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/zssh" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$CURRENT/bin/zssh.mjs" "\$@"
EOF
chmod 700 "$BIN_DIR/zssh"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

INITIAL_CONNECTION_OUTPUT=""
if [[ "$FRESH_CONFIG" == "1" ]]; then
  INITIAL_CONNECTION_OUTPUT="$("$NODE_BIN" "$RELEASE/bin/zssh.mjs" connect initial-chatgpt)"
fi

if [[ "${ZSSH_PROFILE:-private}" == "plugin" ]]; then
  if ! "$NODE_BIN" "$RELEASE/plugin-canary.mjs"; then
    rollback_release
    exit 2
  fi
elif [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
if [[ -n "$INITIAL_CONNECTION_OUTPUT" ]]; then
  printf '\n%s\n' "$INITIAL_CONNECTION_OUTPUT"
  printf '\nStore this connection token/URL now. zSSH stores only its hash and cannot show it again.\n'
fi
\n'* || "$AUDIT_PATH" == *
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
\n'* || "$TARGET_NAME" == *
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
\n'* || "$PUBLIC_URL" == *
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
\n'* || "$ALLOWED_SERVICES" == *
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
\n'* ]]; then
    echo "zSSH configuration values may not contain newlines" >&2
    exit 2
  fi
  if [[ ! "$TARGET_NAME" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then
    echo "ZSSH_TARGET_NAME must use only letters, numbers, dots, underscores, colons, or dashes" >&2
    exit 2
  fi
  if [[ "$PROFILE" != "private" && "$PROFILE" != "plugin" ]]; then
    echo "ZSSH_PROFILE must be private or plugin" >&2
    exit 2
  fi
  if [[ -n "$PUBLIC_URL" && ! "$PUBLIC_URL" =~ ^https://[^[:space:]]+$ ]]; then
    echo "ZSSH_PUBLIC_URL must be empty or an https:// URL" >&2
    exit 2
  fi
  if [[ -n "$ALLOWED_SERVICES" && ! "$ALLOWED_SERVICES" =~ ^[A-Za-z0-9@_.:,-]+$ ]]; then
    echo "ZSSH_ALLOWED_SERVICES must be a comma-separated list of systemd user service names" >&2
    exit 2
  fi
  umask 077
  TOKEN="$(random_hex_32)"
  API_KEY="$(random_hex_32)"
  CAPABILITY_TOKEN="$(random_hex_32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8788
ZSSH_DEV_BEARER_TOKEN=$TOKEN
ZSSH_API_KEY=$API_KEY
ZSSH_MCP_CAPABILITY_TOKEN=$CAPABILITY_TOKEN
ZSSH_TRUST_LOCAL_TUNNEL=0
ZSSH_TARGET_NAME=$TARGET_NAME
ZSSH_ALLOWED_ROOTS=$ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$AUDIT_PATH
EOF
fi

if ! grep -q '^ZSSH_API_KEY=' "$ENV_FILE"; then
  printf '\nZSSH_API_KEY=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
if ! grep -q '^ZSSH_MCP_CAPABILITY_TOKEN=' "$ENV_FILE"; then
  printf '\nZSSH_MCP_CAPABILITY_TOKEN=%s\n' "$(random_hex_32)" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE/deploy/zssh.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi
TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_release() {
  echo "zSSH live validation failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh.service || true
  else
    systemctl --user disable --now zssh.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
systemctl --user enable zssh.service >/dev/null
if ! systemctl --user restart zssh.service; then
  rollback_release
  exit 2
fi

HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:8788/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
if [[ "$HEALTH_OK" != "1" ]]; then
  systemctl --user status zssh.service --no-pager || true
  rollback_release
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${ZSSH_EXEC_MODE:-disabled}" == "full" ]]; then
  if ! ZSSH_MCP_URL="http://127.0.0.1:8788/mcp" \
       ZSSH_MCP_TOKEN="$ZSSH_DEV_BEARER_TOKEN" \
       ZSSH_MCP_API_KEY="" \
       ZSSH_MCP_CAPABILITY_TOKEN="" \
       "$NODE_BIN" "$RELEASE/mcp-claude-canary.mjs"; then
    rollback_release
    exit 2
  fi
else
  if ! "$NODE_BIN" "$RELEASE/live-canary.mjs"; then
    rollback_release
    exit 2
  fi
fi

systemctl --user is-active --quiet zssh.service
printf 'ZSSH_INSTALL_GREEN sha=%s release=%s\n' "$REPO_SHA" "$RELEASE"
