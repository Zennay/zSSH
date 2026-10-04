#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to install zSSH target agent as root." >&2
  exit 2
fi
for required in agent.mjs agent-runtime.mjs agent-transport.mjs package.json deploy/zssh-agent.service.in; do
  [[ -f "$SOURCE_ROOT/$required" ]] || { echo "Missing $required" >&2; exit 2; }
done

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "Node.js and npm are required" >&2
  exit 2
fi
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 20 )) || { echo "Node.js >=20 required" >&2; exit 2; }

REPO_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$REPO_SHA" ]] || { echo "Source root must be a Git checkout" >&2; exit 2; }
if [[ -n "${ZSSH_EXPECTED_SHA:-}" && "$REPO_SHA" != "$ZSSH_EXPECTED_SHA" ]]; then
  echo "Refusing unexpected zSSH revision: expected $ZSSH_EXPECTED_SHA got $REPO_SHA" >&2
  exit 2
fi

CONFIG="$HOME/.config/zssh"
STATE="$HOME/.local/state/zssh-agent"
BASE="$HOME/.local/share/zssh-agent"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
RELEASE="$RELEASES/$REPO_SHA"
STAGE="$RELEASES/.$REPO_SHA.stage.$$"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/zssh-agent.service"
ENV_FILE="$CONFIG/agent.env"

mkdir -p "$CONFIG" "$STATE" "$RELEASES" "$UNIT_DIR"
chmod 700 "$CONFIG" "$STATE"
trap 'rm -rf "$STAGE"' EXIT

validate_plain_env_value() {
  local name="$1"
  local value="$2"
  [[ -n "$value" ]] || { echo "$name must not be empty" >&2; exit 2; }
  case "$value" in
    *[[:space:]]*|*'#'*|*'\\'*|*'"'*|*"'"*)
      echo "$name must not contain whitespace, quotes, backslashes, or #" >&2
      exit 2
      ;;
  esac
}

if [[ ! -f "$ENV_FILE" ]]; then
  : "${ZSSH_TARGET_ID:?Set ZSSH_TARGET_ID to an opaque zt_ target id}"
  : "${ZSSH_GATEWAY_URL:?Set ZSSH_GATEWAY_URL to the public HTTPS gateway origin}"
  : "${ZSSH_AGENT_PRIVATE_KEY_FILE:?Set ZSSH_AGENT_PRIVATE_KEY_FILE to the target-local Ed25519 private key}"
  : "${ZSSH_PUBLIC_ALLOWED_ROOTS:?Set ZSSH_PUBLIC_ALLOWED_ROOTS to explicit non-secret target roots}"

  validate_plain_env_value ZSSH_TARGET_ID "$ZSSH_TARGET_ID"
  validate_plain_env_value ZSSH_GATEWAY_URL "$ZSSH_GATEWAY_URL"
  validate_plain_env_value ZSSH_AGENT_PRIVATE_KEY_FILE "$ZSSH_AGENT_PRIVATE_KEY_FILE"
  validate_plain_env_value ZSSH_PUBLIC_ALLOWED_ROOTS "$ZSSH_PUBLIC_ALLOWED_ROOTS"

  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
ZSSH_PLUGIN_PROFILE=public
ZSSH_TARGET_ID=$ZSSH_TARGET_ID
ZSSH_GATEWAY_URL=$ZSSH_GATEWAY_URL
ZSSH_AGENT_PRIVATE_KEY_FILE=$ZSSH_AGENT_PRIVATE_KEY_FILE
ZSSH_PUBLIC_ALLOWED_ROOTS=$ZSSH_PUBLIC_ALLOWED_ROOTS
ZSSH_ALLOWED_ROOTS=$ZSSH_PUBLIC_ALLOWED_ROOTS
ZSSH_EXEC_MODE=disabled
ZSSH_SAFE_PROGRAMS=uptime,whoami,id,uname,pwd,df,free
ZSSH_COMMAND_TIMEOUT_SECONDS=30
ZSSH_MAX_OUTPUT_BYTES=131072
ZSSH_MAX_FILE_BYTES=131072
ZSSH_AUDIT_LOG=$STATE/audit.jsonl
EOF
fi
chmod 600 "$ENV_FILE"

read_env_value() {
  local key="$1"
  local line
  line="$(grep -m1 "^$key=" "$ENV_FILE" || true)"
  [[ -n "$line" ]] || { echo "Missing $key in $ENV_FILE" >&2; exit 2; }
  printf '%s' "${line#*=}"
}

TARGET_ID="$(read_env_value ZSSH_TARGET_ID)"
GATEWAY_URL="$(read_env_value ZSSH_GATEWAY_URL)"
PRIVATE_KEY_FILE="$(read_env_value ZSSH_AGENT_PRIVATE_KEY_FILE)"
PUBLIC_ROOTS="$(read_env_value ZSSH_PUBLIC_ALLOWED_ROOTS)"

validate_plain_env_value ZSSH_TARGET_ID "$TARGET_ID"
validate_plain_env_value ZSSH_GATEWAY_URL "$GATEWAY_URL"
validate_plain_env_value ZSSH_AGENT_PRIVATE_KEY_FILE "$PRIVATE_KEY_FILE"
validate_plain_env_value ZSSH_PUBLIC_ALLOWED_ROOTS "$PUBLIC_ROOTS"

VALIDATION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/zssh-agent-validate.XXXXXX")"
trap 'rm -rf "$STAGE" "$VALIDATION_ROOT"' EXIT
git -C "$SOURCE_ROOT" archive --format=tar "$REPO_SHA" pairing.mjs | tar -x -C "$VALIDATION_ROOT"

"$NODE_BIN" --input-type=module - "$TARGET_ID" "$GATEWAY_URL" "$PRIVATE_KEY_FILE" "$VALIDATION_ROOT" <<'NODE'
import { lstat, readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const [targetId, gatewayUrl, keyFile, validationRoot] = process.argv.slice(2);
const { normalizeTargetId } = await import(pathToFileURL(validationRoot + "/pairing.mjs"));
if (normalizeTargetId(targetId) === "local") throw new Error("outbound target agent requires an opaque zt_ target id");

const url = new URL(gatewayUrl);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
  throw new Error("ZSSH_GATEWAY_URL must be an HTTPS origin without path/query/credentials");
}

const stat = await lstat(keyFile);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("agent private key must be a regular non-symlink file");
if ((stat.mode & 0o077) !== 0) throw new Error("agent private key must not be group/world accessible");
const key = crypto.createPrivateKey(await readFile(keyFile, "utf8"));
if (key.asymmetricKeyType !== "ed25519") throw new Error("agent private key must use Ed25519");
NODE

rm -rf "$VALIDATION_ROOT"
trap 'rm -rf "$STAGE"' EXIT

verify_release_provenance() {
  git -C "$SOURCE_ROOT" show "${REPO_SHA}:scripts/verify-release-provenance.mjs" |
    "$NODE_BIN" --input-type=module - "$SOURCE_ROOT" "$REPO_SHA" "$RELEASE" --allow-node-modules
}

if [[ ! -d "$RELEASE" ]]; then
  mkdir -p "$STAGE"
  # Export only the exact tracked commit. Never copy the mutable worktree:
  # it may contain untracked .env files, local credentials, or other secrets.
  git -C "$SOURCE_ROOT" archive --format=tar "$REPO_SHA" | tar -x -C "$STAGE"
  rm -rf "$STAGE/node_modules" "$STAGE/data"
  "$NPM_BIN" ci --prefix "$STAGE" --omit=dev --ignore-scripts --no-audit --no-fund
  "$NPM_BIN" test --prefix "$STAGE"
  mv "$STAGE" "$RELEASE"
fi

verify_release_provenance
"$NPM_BIN" ci --prefix "$RELEASE" --omit=dev --ignore-scripts --no-audit --no-fund
verify_release_provenance

TMP_LINK="$BASE/.current.$$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$RELEASE/deploy/zssh-agent.service.in" > "$UNIT"
chmod 600 "$UNIT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user daemon-reload
systemctl --user enable --now zssh-agent.service >/dev/null
systemctl --user is-active --quiet zssh-agent.service

printf 'ZSSH_AGENT_INSTALL_GREEN sha=%s target=%s service=zssh-agent.service\n' "$REPO_SHA" "$TARGET_ID"
