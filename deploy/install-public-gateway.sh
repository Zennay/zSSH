#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to install the zSSH public gateway as root." >&2
  exit 2
fi
for required in server.mjs agent-transport.mjs pairing.mjs package.json deploy/zssh-public.service.in; do
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

: "${ZSSH_PUBLIC_BASE_URL:?Set ZSSH_PUBLIC_BASE_URL to the canonical public HTTPS origin}"
: "${ZSSH_OAUTH_ISSUER:?Set ZSSH_OAUTH_ISSUER to the production OAuth issuer}"
: "${ZSSH_OAUTH_JWKS_URI:?Set ZSSH_OAUTH_JWKS_URI to the production JWKS URL}"
: "${ZSSH_TARGET_ID:?Set ZSSH_TARGET_ID to the reviewer target zt_ identifier}"
: "${ZSSH_AGENT_PUBLIC_KEYS_FILE:?Set ZSSH_AGENT_PUBLIC_KEYS_FILE to the reviewer public trust JSON}"
: "${ZSSH_PUBLIC_ALLOWED_ROOTS:?Set ZSSH_PUBLIC_ALLOWED_ROOTS to explicit reviewer-safe roots}"

PORT_VALUE="${ZSSH_PUBLIC_GATEWAY_PORT:-8789}"
CHALLENGE_TOKEN="${OPENAI_APPS_CHALLENGE_TOKEN:-}"

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

for pair in   "ZSSH_PUBLIC_BASE_URL=$ZSSH_PUBLIC_BASE_URL"   "ZSSH_OAUTH_ISSUER=$ZSSH_OAUTH_ISSUER"   "ZSSH_OAUTH_JWKS_URI=$ZSSH_OAUTH_JWKS_URI"   "ZSSH_TARGET_ID=$ZSSH_TARGET_ID"   "ZSSH_AGENT_PUBLIC_KEYS_FILE=$ZSSH_AGENT_PUBLIC_KEYS_FILE"   "ZSSH_PUBLIC_ALLOWED_ROOTS=$ZSSH_PUBLIC_ALLOWED_ROOTS"; do
  validate_plain_env_value "${pair%%=*}" "${pair#*=}"
done
if [[ -n "$CHALLENGE_TOKEN" ]]; then
  validate_plain_env_value OPENAI_APPS_CHALLENGE_TOKEN "$CHALLENGE_TOKEN"
  (( ${#CHALLENGE_TOKEN} >= 16 )) || { echo "OPENAI_APPS_CHALLENGE_TOKEN must be at least 16 characters" >&2; exit 2; }
fi
[[ "$PORT_VALUE" =~ ^[0-9]+$ ]] && (( PORT_VALUE >= 1024 && PORT_VALUE <= 65535 )) || {
  echo "ZSSH_PUBLIC_GATEWAY_PORT must be an integer between 1024 and 65535" >&2
  exit 2
}

"$NODE_BIN" --input-type=module -   "$SOURCE_ROOT"   "$ZSSH_PUBLIC_BASE_URL"   "$ZSSH_OAUTH_ISSUER"   "$ZSSH_OAUTH_JWKS_URI"   "$ZSSH_TARGET_ID"   "$ZSSH_AGENT_PUBLIC_KEYS_FILE"   "$ZSSH_PUBLIC_ALLOWED_ROOTS" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { pathToFileURL } from "node:url";

const [sourceRoot, publicBase, issuer, jwks, targetId, trustFile, publicRoots] = process.argv.slice(2);
const { normalizeTargetId } = await import(pathToFileURL(sourceRoot + "/pairing.mjs"));
const { agentPublicKeysFromEnv } = await import(pathToFileURL(sourceRoot + "/agent-transport.mjs"));

function httpsUrl(value, name, { originOnly = false } = {}) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(name + " must be HTTPS without credentials or fragment");
  }
  if (originOnly && (url.pathname !== "/" || url.search)) {
    throw new Error(name + " must be an HTTPS origin without path or query");
  }
  return url;
}

const resource = httpsUrl(publicBase, "ZSSH_PUBLIC_BASE_URL", { originOnly: true });
if (
  resource.hostname === "localhost" ||
  resource.hostname.endsWith(".local") ||
  net.isIP(resource.hostname)
) {
  throw new Error("ZSSH_PUBLIC_BASE_URL must use a public DNS hostname, not localhost or an IP literal");
}
httpsUrl(issuer, "ZSSH_OAUTH_ISSUER");
httpsUrl(jwks, "ZSSH_OAUTH_JWKS_URI");

const normalizedTarget = normalizeTargetId(targetId);
if (normalizedTarget === "local") throw new Error("public gateway requires an opaque zt_ target id");

if (!path.isAbsolute(trustFile)) {
  throw new Error("ZSSH_AGENT_PUBLIC_KEYS_FILE must be an absolute file");
}
const trustStat = fs.lstatSync(trustFile);
if (!trustStat.isFile() || trustStat.isSymbolicLink()) {
  throw new Error("ZSSH_AGENT_PUBLIC_KEYS_FILE must be a regular non-symlink file");
}
if ((trustStat.mode & 0o022) !== 0) {
  throw new Error("ZSSH_AGENT_PUBLIC_KEYS_FILE must not be group/world writable");
}
const trusted = agentPublicKeysFromEnv({ ZSSH_AGENT_PUBLIC_KEYS_FILE: trustFile });
if (!trusted.has(normalizedTarget)) {
  throw new Error("reviewer target id is not present in ZSSH_AGENT_PUBLIC_KEYS_FILE");
}
if (trusted.size !== 1) {
  throw new Error("reviewer public gateway bootstrap expects exactly one trusted target");
}

for (const value of publicRoots.split(",")) {
  if (!path.isAbsolute(value.trim())) throw new Error("ZSSH_PUBLIC_ALLOWED_ROOTS entries must be absolute paths");
}

console.log(JSON.stringify({
  ok: true,
  endpoint: resource.origin + "/mcp",
  oauth_issuer: new URL(issuer).origin,
  target_id: normalizedTarget,
  trusted_target_count: trusted.size,
}, null, 2));
NODE

if [[ "${ZSSH_PUBLIC_GATEWAY_VALIDATE_ONLY:-0}" == "1" ]]; then
  echo "ZSSH_PUBLIC_GATEWAY_CONFIG_GREEN sha=$REPO_SHA"
  exit 0
fi

CONFIG="$HOME/.config/zssh"
STATE="$HOME/.local/state/zssh-public"
BASE="$HOME/.local/share/zssh-public"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
RELEASE="$RELEASES/$REPO_SHA"
STAGE="$RELEASES/.$REPO_SHA.stage.$$"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/zssh-public.service"
ENV_FILE="$CONFIG/public-gateway.env"
PAIRING_FILE="$CONFIG/public-pairings.json"
AUDIT_LOG="$STATE/audit.jsonl"

mkdir -p "$CONFIG" "$STATE" "$RELEASES" "$UNIT_DIR"
chmod 700 "$CONFIG" "$STATE"
trap 'rm -rf "$STAGE"' EXIT

if [[ ! -d "$RELEASE" ]]; then
  mkdir -p "$STAGE"
  git -C "$SOURCE_ROOT" archive --format=tar "$REPO_SHA" | tar -x -C "$STAGE"
  "$NPM_BIN" install --prefix "$STAGE" --omit=dev --ignore-scripts --no-audit --no-fund
  "$NPM_BIN" test --prefix "$STAGE"
  mv "$STAGE" "$RELEASE"
fi

ENV_BACKUP=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_BACKUP="$CONFIG/.public-gateway.env.backup.$"
  cp "$ENV_FILE" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
fi

umask 077
{
  echo "NODE_ENV=production"
  echo "PORT=$PORT_VALUE"
  echo "ZSSH_PLUGIN_PROFILE=public"
  echo "ZSSH_PUBLIC_AUTH_MODE=oauth"
  echo "ZSSH_PUBLIC_BASE_URL=$ZSSH_PUBLIC_BASE_URL"
  echo "ZSSH_OAUTH_ISSUER=$ZSSH_OAUTH_ISSUER"
  echo "ZSSH_OAUTH_JWKS_URI=$ZSSH_OAUTH_JWKS_URI"
  echo "ZSSH_OAUTH_SCOPES=zssh:read,zssh:write"
  echo "ZSSH_OAUTH_READ_SCOPE=zssh:read"
  echo "ZSSH_OAUTH_WRITE_SCOPE=zssh:write"
  echo "ZSSH_PAIRING_REQUIRED=1"
  echo "ZSSH_PAIRING_FILE=$PAIRING_FILE"
  echo "ZSSH_PAIRING_REQUEST_TTL_SECONDS=900"
  echo "ZSSH_TARGET_ID=$ZSSH_TARGET_ID"
  echo "ZSSH_AGENT_PUBLIC_KEYS_FILE=$ZSSH_AGENT_PUBLIC_KEYS_FILE"
  echo "ZSSH_AGENT_MAX_CLOCK_SKEW_MS=60000"
  echo "ZSSH_AGENT_REQUEST_TIMEOUT_MS=30000"
  echo "ZSSH_AGENT_POLL_TIMEOUT_MS=25000"
  echo "ZSSH_AGENT_MAX_PENDING=16"
  echo "ZSSH_PUBLIC_ALLOWED_ROOTS=$ZSSH_PUBLIC_ALLOWED_ROOTS"
  echo "ZSSH_ALLOWED_ROOTS=$ZSSH_PUBLIC_ALLOWED_ROOTS"
  echo "ZSSH_EXEC_MODE=disabled"
  echo "ZSSH_COMMAND_TIMEOUT_SECONDS=30"
  echo "ZSSH_MAX_OUTPUT_BYTES=131072"
  echo "ZSSH_MAX_FILE_BYTES=131072"
  echo "ZSSH_AUDIT_LOG=$AUDIT_LOG"
  if [[ -n "$CHALLENGE_TOKEN" ]]; then
    echo "OPENAI_APPS_CHALLENGE_TOKEN=$CHALLENGE_TOKEN"
  fi
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

sed "s|@NODE_BIN@|$NODE_BIN|g" "$SOURCE_ROOT/deploy/zssh-public.service.in" > "$UNIT"
chmod 600 "$UNIT"

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT" || true)"
fi

TMP_LINK="$BASE/.current.$"
ln -s "$RELEASE" "$TMP_LINK"
mv -Tf "$TMP_LINK" "$CURRENT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

rollback_public_gateway() {
  echo "zSSH public gateway validation failed; restoring previous state" >&2
  if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    mv -f "$ENV_BACKUP" "$ENV_FILE"
  fi
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local rollback_link="$BASE/.rollback.$"
    ln -s "$PREVIOUS" "$rollback_link"
    mv -Tf "$rollback_link" "$CURRENT"
    systemctl --user daemon-reload || true
    systemctl --user restart zssh-public.service || true
  else
    systemctl --user disable --now zssh-public.service || true
    rm -f "$CURRENT"
  fi
}

systemctl --user daemon-reload
if ! systemctl --user enable --now zssh-public.service >/dev/null; then
  rollback_public_gateway
  exit 2
fi

health="http://127.0.0.1:$PORT_VALUE/health"
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "$health" >/dev/null; then
    systemctl --user is-active --quiet zssh-public.service
    [[ -z "$ENV_BACKUP" ]] || rm -f "$ENV_BACKUP"
    printf 'ZSSH_PUBLIC_GATEWAY_INSTALL_GREEN sha=%s endpoint=%s/mcp target=%s service=zssh-public.service port=%s\n' \
      "$REPO_SHA" "${ZSSH_PUBLIC_BASE_URL%/}" "$ZSSH_TARGET_ID" "$PORT_VALUE"
    exit 0
  fi
  sleep 1
done

systemctl --user status zssh-public.service --no-pager || true
rollback_public_gateway
echo "zSSH public gateway failed local health validation" >&2
exit 2
