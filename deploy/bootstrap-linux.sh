#!/usr/bin/env bash
set -Eeuo pipefail

# Safe, repeatable bootstrap for a dedicated unprivileged zSSH user on a Linux target.
# Pin the source revision with ZSSH_REF for reproducible installs.
REPO_URL="${ZSSH_REPO_URL:-https://github.com/Zennay/zSSH.git}"
REF="${ZSSH_REF:-main}"
SOURCE_ROOT="${ZSSH_SOURCE_ROOT:-$HOME/.local/src/zssh}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to bootstrap zSSH as root; run as the dedicated service user." >&2
  exit 2
fi

for command_name in git node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name (install Node.js 20+ and git first)." >&2
    exit 2
  fi
done

mkdir -p "$(dirname "$SOURCE_ROOT")"
if [[ -e "$SOURCE_ROOT" && ! -d "$SOURCE_ROOT/.git" ]]; then
  echo "Refusing to use non-Git path: $SOURCE_ROOT" >&2
  exit 2
fi

if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  git clone --origin origin "$REPO_URL" "$SOURCE_ROOT"
else
  origin_url="$(git -C "$SOURCE_ROOT" remote get-url origin)"
  if [[ "$origin_url" != "$REPO_URL" && "$origin_url" != "${REPO_URL%.git}" && "$origin_url" != "${REPO_URL}.git" ]]; then
    echo "Refusing unexpected zSSH origin: $origin_url" >&2
    exit 2
  fi
fi

git -C "$SOURCE_ROOT" fetch --depth=1 origin "$REF"
git -C "$SOURCE_ROOT" checkout --force --detach FETCH_HEAD
EXPECTED_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"

ZSSH_EXPECTED_SHA="$EXPECTED_SHA" bash "$SOURCE_ROOT/deploy/install-live.sh" "$SOURCE_ROOT"
printf 'ZSSH_BOOTSTRAP_GREEN sha=%s source=%s\n' "$EXPECTED_SHA" "$SOURCE_ROOT"
printf 'Next: cd "%s" && bash deploy/configure-tunnel.sh after creating an OpenAI MCP tunnel.\n' "$SOURCE_ROOT"
