#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Refusing to install sudoers policy without root; rerun explicitly with sudo." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RENDERER="$ROOT/scripts/render-scoped-sudoers.mjs"
NODE_BIN="$(command -v node || true)"
VISUDO_BIN="$(command -v visudo || true)"
SYSTEMCTL_BIN="$(command -v systemctl || true)"

if [[ -z "$NODE_BIN" || -z "$VISUDO_BIN" || -z "$SYSTEMCTL_BIN" ]]; then
  echo "node, visudo, and systemctl are required" >&2
  exit 2
fi

USER_NAME=""
ARGS=()
while (($#)); do
  case "$1" in
    --user)
      [[ $# -ge 2 ]] || { echo "--user requires a value" >&2; exit 2; }
      USER_NAME="$2"
      ARGS+=("--user" "$2")
      shift 2
      ;;
    --inspect-service|--restart-service)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 2; }
      ARGS+=("$1" "$2")
      shift 2
      ;;
    --systemctl-path)
      [[ $# -ge 2 ]] || { echo "--systemctl-path requires a value" >&2; exit 2; }
      SYSTEMCTL_BIN="$2"
      shift 2
      ;;
    --help)
      "$NODE_BIN" "$RENDERER" --help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! "$USER_NAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "A valid explicit --user is required" >&2
  exit 2
fi

ARGS+=("--systemctl-path" "$SYSTEMCTL_BIN")
TARGET="/etc/sudoers.d/for-zssh-$USER_NAME"
if [[ -L "$TARGET" ]]; then
  echo "Refusing symlink sudoers destination: $TARGET" >&2
  exit 2
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
umask 077

"$NODE_BIN" "$RENDERER" "${ARGS[@]}" > "$TMP"
"$VISUDO_BIN" -cf "$TMP"
install -o root -g root -m 0440 "$TMP" "$TARGET"
"$VISUDO_BIN" -cf "$TARGET"

printf 'ZSSH_SCOPED_SUDO_GREEN user=%s policy=%s\n' "$USER_NAME" "$TARGET"
