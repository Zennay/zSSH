#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to install zSSH public Caddy ingress as root; use the bounded sudo path." >&2
  exit 2
fi

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "Node.js is required" >&2; exit 2; }
GIT_BIN="$(command -v git || true)"
[[ -n "$GIT_BIN" ]] || { echo "git is required" >&2; exit 2; }
TAR_BIN="$(command -v tar || true)"
[[ -n "$TAR_BIN" ]] || { echo "tar is required" >&2; exit 2; }

REPO_SHA="${ZSSH_EXPECTED_SHA:-$("$GIT_BIN" -C "$SOURCE_ROOT" rev-parse HEAD)}"
[[ "$REPO_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ZSSH_EXPECTED_SHA / repository HEAD must be a full 40-character Git commit SHA" >&2
  exit 2
}
"$GIT_BIN" -C "$SOURCE_ROOT" cat-file -e "$REPO_SHA^{commit}" 2>/dev/null || {
  echo "Requested zSSH release commit is not available in the source repository" >&2
  exit 2
}

: "${ZSSH_PUBLIC_BASE_URL:?Set ZSSH_PUBLIC_BASE_URL to the canonical public HTTPS origin}"
PORT_VALUE="${ZSSH_PUBLIC_GATEWAY_PORT:-8789}"
ROOT_FILE="${ZSSH_CADDY_ROOT_FILE:-/etc/caddy/Caddyfile}"
SNIPPET_FILE="${ZSSH_CADDY_SNIPPET_FILE:-/etc/caddy/zssh-public.caddy}"
TEST_MODE="${ZSSH_CADDY_TEST_MODE:-0}"
VALIDATE_ONLY="${ZSSH_CADDY_VALIDATE_ONLY:-0}"

[[ "$ROOT_FILE" = /* ]] || { echo "ZSSH_CADDY_ROOT_FILE must be absolute" >&2; exit 2; }
[[ "$SNIPPET_FILE" = /* ]] || { echo "ZSSH_CADDY_SNIPPET_FILE must be absolute" >&2; exit 2; }
[[ "$ROOT_FILE" != "$SNIPPET_FILE" ]] || { echo "Caddy root and snippet files must differ" >&2; exit 2; }

for path_value in "$ROOT_FILE" "$SNIPPET_FILE"; do
  case "$path_value" in
    *[[:space:]]*|*'#'*|*'\\'*|*'"'*|*"'"*)
      echo "Caddy paths must not contain whitespace, quotes, backslashes, or #" >&2
      exit 2
      ;;
  esac
done

if [[ "$TEST_MODE" != "1" ]]; then
  [[ "$ROOT_FILE" == "/etc/caddy/Caddyfile" ]] || {
    echo "Production Caddy root must remain /etc/caddy/Caddyfile" >&2
    exit 2
  }
  [[ "$SNIPPET_FILE" == /etc/caddy/* ]] || {
    echo "Production zSSH Caddy snippet must remain under /etc/caddy" >&2
    exit 2
  }
fi

tmp_dir="$(mktemp -d)"
cleanup_local() {
  rm -rf "$tmp_dir"
}
trap cleanup_local EXIT

validation_root="$tmp_dir/release-validation"
mkdir -p "$validation_root"
"$GIT_BIN" -C "$SOURCE_ROOT" archive --format=tar "$REPO_SHA" scripts/render-public-caddy.mjs | "$TAR_BIN" -x -C "$validation_root"
renderer="$validation_root/scripts/render-public-caddy.mjs"
[[ -f "$renderer" ]] || {
  echo "Immutable release is missing scripts/render-public-caddy.mjs" >&2
  exit 2
}

rendered="$tmp_dir/zssh-public.caddy"
ZSSH_PUBLIC_GATEWAY_PORT="$PORT_VALUE" ZSSH_PUBLIC_BASE_URL="$ZSSH_PUBLIC_BASE_URL" \
  "$NODE_BIN" "$renderer" > "$rendered"

host="$("$NODE_BIN" -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$ZSSH_PUBLIC_BASE_URL")"
grep -Fx "$host {" "$rendered" >/dev/null
grep -Fx "    reverse_proxy 127.0.0.1:$PORT_VALUE" "$rendered" >/dev/null

if [[ "$VALIDATE_ONLY" == "1" ]]; then
  printf 'ZSSH_PUBLIC_CADDY_CONFIG_GREEN host=%s port=%s release_sha=%s snippet_sha256=%s\n' \
    "$host" "$PORT_VALUE" "$REPO_SHA" "$(sha256sum "$rendered" | awk '{print $1}')"
  exit 0
fi

sudo -n true >/dev/null 2>&1 || {
  echo "Non-interactive sudo is required for Caddy promotion" >&2
  exit 2
}

CADDY_BIN="$(command -v caddy || true)"
[[ -n "$CADDY_BIN" ]] || { echo "Caddy binary is required" >&2; exit 2; }

sudo -n test -f "$ROOT_FILE" || { echo "Caddy root config is missing: $ROOT_FILE" >&2; exit 2; }
if sudo -n test -L "$ROOT_FILE"; then
  echo "Refusing symlink Caddy root config" >&2
  exit 2
fi
if sudo -n test -e "$SNIPPET_FILE" && sudo -n test -L "$SNIPPET_FILE"; then
  echo "Refusing symlink zSSH Caddy snippet" >&2
  exit 2
fi
sudo -n systemctl is-active --quiet caddy || {
  echo "Caddy service must be active before production ingress promotion" >&2
  exit 2
}

root_backup="$tmp_dir/Caddyfile.before"
sudo -n cat "$ROOT_FILE" > "$root_backup"
root_mode="$(sudo -n stat -c '%a' "$ROOT_FILE")"
root_uid="$(sudo -n stat -c '%u' "$ROOT_FILE")"
root_gid="$(sudo -n stat -c '%g' "$ROOT_FILE")"

snippet_existed=0
snippet_backup="$tmp_dir/zssh-public.caddy.before"
snippet_mode="644"
snippet_uid="$root_uid"
snippet_gid="$root_gid"
if sudo -n test -f "$SNIPPET_FILE"; then
  snippet_existed=1
  sudo -n cat "$SNIPPET_FILE" > "$snippet_backup"
  snippet_mode="$(sudo -n stat -c '%a' "$SNIPPET_FILE")"
  snippet_uid="$(sudo -n stat -c '%u' "$SNIPPET_FILE")"
  snippet_gid="$(sudo -n stat -c '%g' "$SNIPPET_FILE")"
fi

candidate_root="$tmp_dir/Caddyfile.candidate"
cp "$root_backup" "$candidate_root"

begin_marker="# BEGIN zSSH managed public ingress"
end_marker="# END zSSH managed public ingress"
begin_count="$(grep -Fxc "$begin_marker" "$candidate_root" || true)"
end_count="$(grep -Fxc "$end_marker" "$candidate_root" || true)"
if [[ "$begin_count" == "0" && "$end_count" == "0" ]]; then
  if grep -Fq "$host {" "$candidate_root"; then
    echo "Caddy root already contains the production host outside the zSSH managed block" >&2
    exit 2
  fi
  {
    printf '\n%s\n' "$begin_marker"
    printf 'import %s\n' "$SNIPPET_FILE"
    printf '%s\n' "$end_marker"
  } >> "$candidate_root"
elif [[ "$begin_count" == "1" && "$end_count" == "1" ]]; then
  CANDIDATE_ROOT="$candidate_root" SNIPPET_FILE="$SNIPPET_FILE" \
    "$NODE_BIN" --input-type=module <<'NODE'
import fs from "node:fs";
const file = process.env.CANDIDATE_ROOT;
const begin = "# BEGIN zSSH managed public ingress";
const end = "# END zSSH managed public ingress";
const text = fs.readFileSync(file, "utf8");
const start = text.indexOf(begin);
const stop = text.indexOf(end, start + begin.length);
if (start < 0 || stop < 0 || stop < start) throw new Error("invalid zSSH managed Caddy block");
const replacement = begin + "\nimport " + process.env.SNIPPET_FILE + "\n" + end;
fs.writeFileSync(file, text.slice(0, start) + replacement + text.slice(stop + end.length), "utf8");
NODE
else
  echo "Caddy root contains duplicate or incomplete zSSH managed markers" >&2
  exit 2
fi

root_stage="$ROOT_FILE.zssh-stage.$$"
snippet_stage="$SNIPPET_FILE.zssh-stage.$$"

cleanup_root_stages() {
  sudo -n rm -f "$root_stage" "$snippet_stage" >/dev/null 2>&1 || true
}
trap 'cleanup_root_stages; cleanup_local' EXIT

install_atomic() {
  local source="$1"
  local destination="$2"
  local stage="$3"
  local mode="$4"
  local uid="$5"
  local gid="$6"
  sudo -n install -m "$mode" -o "$uid" -g "$gid" "$source" "$stage"
  sudo -n mv -f "$stage" "$destination"
}

restore_disk() {
  install_atomic "$root_backup" "$ROOT_FILE" "$root_stage" "$root_mode" "$root_uid" "$root_gid" || true
  if [[ "$snippet_existed" == "1" ]]; then
    install_atomic "$snippet_backup" "$SNIPPET_FILE" "$snippet_stage" "$snippet_mode" "$snippet_uid" "$snippet_gid" || true
  else
    sudo -n rm -f "$SNIPPET_FILE" "$snippet_stage" || true
  fi
}

install_atomic "$rendered" "$SNIPPET_FILE" "$snippet_stage" "$snippet_mode" "$snippet_uid" "$snippet_gid"
install_atomic "$candidate_root" "$ROOT_FILE" "$root_stage" "$root_mode" "$root_uid" "$root_gid"

if ! sudo -n "$CADDY_BIN" validate --config "$ROOT_FILE" --adapter caddyfile >/dev/null 2>&1; then
  echo "Caddy validation failed; restoring previous disk configuration" >&2
  restore_disk
  exit 2
fi

if ! sudo -n systemctl reload caddy; then
  echo "Caddy reload failed; restoring previous disk configuration" >&2
  restore_disk
  sudo -n "$CADDY_BIN" validate --config "$ROOT_FILE" --adapter caddyfile >/dev/null 2>&1 || true
  sudo -n systemctl reload caddy >/dev/null 2>&1 || true
  exit 2
fi

sudo -n systemctl is-active --quiet caddy || {
  echo "Caddy became inactive after reload; restoring previous disk configuration" >&2
  restore_disk
  sudo -n systemctl reload caddy >/dev/null 2>&1 || true
  exit 2
}

printf 'ZSSH_PUBLIC_CADDY_INSTALL_GREEN host=%s port=%s release_sha=%s root_sha256=%s snippet_sha256=%s\n' \
  "$host" \
  "$PORT_VALUE" \
  "$REPO_SHA" \
  "$(sudo -n sha256sum "$ROOT_FILE" | awk '{print $1}')" \
  "$(sudo -n sha256sum "$SNIPPET_FILE" | awk '{print $1}')"
