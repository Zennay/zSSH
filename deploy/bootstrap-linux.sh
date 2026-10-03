#!/usr/bin/env bash
set -Eeuo pipefail

# Provider-agnostic zSSH bootstrap for a dedicated unprivileged Linux user.
# Pin ZSSH_REF to a commit SHA for reproducible production installs.
REPO_URL="${ZSSH_REPO_URL:-https://github.com/Zennay/zSSH.git}"
REF="${ZSSH_REF:-main}"
SOURCE_ROOT="${ZSSH_SOURCE_ROOT:-$HOME/.local/src/zssh}"
DEFAULT_ALLOWED_ROOT="${ZSSH_DEFAULT_ALLOWED_ROOT:-$HOME/zssh-workspace}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to bootstrap zSSH as root; run as the dedicated service user." >&2
  exit 2
fi

for command_name in git node npm systemctl curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 2
  fi
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 20 )); then
  echo "Node.js >=20 required; found $(node --version)" >&2
  exit 2
fi

mkdir -p "$(dirname "$SOURCE_ROOT")"
if [[ -e "$SOURCE_ROOT" && ! -d "$SOURCE_ROOT/.git" ]]; then
  echo "Refusing to use non-Git source path: $SOURCE_ROOT" >&2
  exit 2
fi

if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  git clone --origin origin "$REPO_URL" "$SOURCE_ROOT"
else
  origin_url="$(git -C "$SOURCE_ROOT" remote get-url origin)"
  normalized_origin="${origin_url%.git}"
  normalized_expected="${REPO_URL%.git}"
  if [[ "$normalized_origin" != "$normalized_expected" ]]; then
    echo "Refusing unexpected zSSH origin: $origin_url" >&2
    exit 2
  fi
fi

git -C "$SOURCE_ROOT" fetch --depth=1 origin "$REF"
git -C "$SOURCE_ROOT" checkout --force --detach FETCH_HEAD
EXPECTED_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"

if [[ -z "${ZSSH_ALLOWED_ROOTS:-}" ]]; then
  mkdir -p "$DEFAULT_ALLOWED_ROOT"
  export ZSSH_ALLOWED_ROOTS="$DEFAULT_ALLOWED_ROOT"
fi

ZSSH_EXPECTED_SHA="$EXPECTED_SHA" bash "$SOURCE_ROOT/deploy/install-live.sh" "$SOURCE_ROOT"

printf 'ZSSH_GENERIC_BOOTSTRAP_GREEN sha=%s source=%s allowed_roots=%s\n' \
  "$EXPECTED_SHA" "$SOURCE_ROOT" "$ZSSH_ALLOWED_ROOTS"
printf 'Service: systemctl --user status zssh.service\n'
printf 'Diagnostics: bash "%s/ops/diagnose.sh"\n' "$SOURCE_ROOT"
