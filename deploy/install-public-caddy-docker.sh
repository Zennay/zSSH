#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to promote Docker Caddy ingress as root; use the bounded sudo path." >&2
  exit 2
fi

for command_name in node git tar docker curl sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command is missing: $command_name" >&2
    exit 2
  }
done
sudo -n true >/dev/null 2>&1 || {
  echo "Non-interactive sudo is required for Docker Caddy promotion" >&2
  exit 2
}

DOCKER=(sudo -n docker)

REPO_SHA="${ZSSH_EXPECTED_SHA:-$(git -C "$SOURCE_ROOT" rev-parse HEAD)}"
[[ "$REPO_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ZSSH_EXPECTED_SHA / repository HEAD must be a full 40-character Git commit SHA" >&2
  exit 2
}
git -C "$SOURCE_ROOT" cat-file -e "$REPO_SHA^{commit}" 2>/dev/null || {
  echo "Requested zSSH release commit is not available in the source repository" >&2
  exit 2
}

: "${ZSSH_PUBLIC_BASE_URL:?Set ZSSH_PUBLIC_BASE_URL to the canonical public HTTPS origin}"
PORT_VALUE="${ZSSH_PUBLIC_GATEWAY_PORT:-8789}"
CONTAINER_NAME="${ZSSH_CADDY_DOCKER_NAME:-zssh-https}"
ROOT_FILE="${ZSSH_CADDY_DOCKER_ROOT_FILE:-/home/ubuntu/.config/zssh/https/Caddyfile}"
TEST_MODE="${ZSSH_CADDY_DOCKER_TEST_MODE:-0}"
HEALTH_ATTEMPTS="${ZSSH_CADDY_HEALTH_ATTEMPTS:-60}"

[[ "$ROOT_FILE" = /* ]] || { echo "Caddy root config must be absolute" >&2; exit 2; }
[[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Invalid Caddy container name" >&2; exit 2; }
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || { echo "Health attempts must be a positive integer" >&2; exit 2; }
if [[ "$TEST_MODE" != "1" ]]; then
  [[ "$CONTAINER_NAME" == "zssh-https" ]] || { echo "Production Caddy container must be zssh-https" >&2; exit 2; }
  [[ "$ROOT_FILE" == "/home/ubuntu/.config/zssh/https/Caddyfile" ]] || {
    echo "Production Caddy config must remain /home/ubuntu/.config/zssh/https/Caddyfile" >&2
    exit 2
  }
  [[ "$HEALTH_ATTEMPTS" -le 60 ]] || { echo "Production health attempts must not exceed 60" >&2; exit 2; }
fi

tmp_dir="$(mktemp -d)"
container_candidate="/tmp/zssh-Caddyfile-candidate-$$"
promoted=0
committed=0
backup_file="$tmp_dir/Caddyfile.before"
cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$promoted" == "1" && "$committed" != "1" ]]; then
    echo "Caddy health verification failed; restoring the previous mounted config." >&2
    write_config_in_place "$backup_file"
    "${DOCKER[@]}" restart --time 10 "$CONTAINER_NAME" >/dev/null
    "${DOCKER[@]}" exec "$CONTAINER_NAME" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
    "${DOCKER[@]}" inspect --format '{{.State.Running}}' "$CONTAINER_NAME" | grep -Fx true >/dev/null
    echo "ZSSH_PUBLIC_CADDY_DOCKER_ROLLBACK_COMPLETE" >&2
  fi
  "${DOCKER[@]}" exec "$CONTAINER_NAME" rm -f "$container_candidate" >/dev/null 2>&1
  rm -rf "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT

validation_root="$tmp_dir/release-validation"
mkdir -p "$validation_root"
git -C "$SOURCE_ROOT" archive --format=tar "$REPO_SHA" scripts/render-public-caddy.mjs | tar -x -C "$validation_root"
renderer="$validation_root/scripts/render-public-caddy.mjs"
[[ -f "$renderer" ]] || { echo "Immutable release is missing the public Caddy renderer" >&2; exit 2; }

rendered="$tmp_dir/zssh-public.caddy"
ZSSH_PUBLIC_GATEWAY_PORT="$PORT_VALUE" ZSSH_PUBLIC_BASE_URL="$ZSSH_PUBLIC_BASE_URL" node "$renderer" > "$rendered"
host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$ZSSH_PUBLIC_BASE_URL")"
grep -Fx "$host {" "$rendered" >/dev/null
grep -Fx "    reverse_proxy 127.0.0.1:$PORT_VALUE" "$rendered" >/dev/null

sudo -n test -f "$ROOT_FILE" || { echo "Mounted Caddy config is missing: $ROOT_FILE" >&2; exit 2; }
if sudo -n test -L "$ROOT_FILE"; then
  echo "Refusing symlink Caddy config" >&2
  exit 2
fi

inspect_topology() {
  "${DOCKER[@]}" inspect --format '{{.State.Running}}|{{.HostConfig.NetworkMode}}|{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}|{{.RW}}{{end}}{{end}}' "$CONTAINER_NAME"
}
topology="$(inspect_topology)"
expected_topology="true|host|$ROOT_FILE|false"
if [[ "$topology" != "$expected_topology" ]]; then
  echo "Docker Caddy topology mismatch; expected running host-network container with read-only Caddyfile mount." >&2
  exit 2
fi

# Do not switch ingress unless the isolated public gateway is already healthy.
gateway_health="$tmp_dir/gateway-health.json"
curl --fail --silent --show-error --connect-timeout 3 --max-time 8 \
  "http://127.0.0.1:$PORT_VALUE/health" > "$gateway_health"
node --input-type=module - "$gateway_health" <<'NODE'
import { readFileSync } from "node:fs";
const value = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (value?.ok !== true || value?.service !== "zssh") {
  throw new Error("isolated public gateway did not report healthy zSSH");
}
NODE

root_identity="$(sudo -n stat -c '%d:%i' "$ROOT_FILE")"
sudo -n cat "$ROOT_FILE" > "$backup_file"
original_sha="$(sha256sum "$backup_file" | awk '{print $1}')"

# The Caddyfile is a bind-mounted single file. Replacing its pathname with mv
# would leave the running container attached to the old inode, so update the
# verified regular file in place and retain its inode.
write_config_in_place() {
  local source_file="$1"
  sudo -n python3 - "$ROOT_FILE" "$source_file" "$root_identity" <<'PY'
import os
import stat
import sys

destination, source, expected_identity = sys.argv[1:]
flags = os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
fd = os.open(destination, flags)
try:
    info = os.fstat(fd)
    identity = f"{info.st_dev}:{info.st_ino}"
    if not stat.S_ISREG(info.st_mode):
        raise SystemExit("Caddy config destination is not a regular file")
    if identity != expected_identity:
        raise SystemExit("Caddy config inode changed; refusing in-place write")
    with open(source, "rb") as stream:
        payload = stream.read()
    os.ftruncate(fd, 0)
    with os.fdopen(fd, "wb", closefd=False) as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())
finally:
    os.close(fd)
PY
}

# Preserve the existing TLS issuer, global admin policy, and response headers.
# Only the site hostname and its loopback upstream may change in this transaction.
for required in \
  "admin off" \
  "auto_https disable_redirects" \
  "profile shortlived" \
  "X-Content-Type-Options nosniff" \
  "Referrer-Policy same-origin"; do
  grep -Fq "$required" "$backup_file" || {
    echo "Existing Caddy security/TLS policy is not the expected reviewed configuration; refusing promotion." >&2
    exit 2
  }
done

candidate="$tmp_dir/Caddyfile.candidate"
CADDY_SOURCE="$backup_file" CADDY_DEST="$candidate" TARGET_HOST="$host" TARGET_PORT="$PORT_VALUE" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync(process.env.CADDY_SOURCE, "utf8");
const host = process.env.TARGET_HOST;
const port = process.env.TARGET_PORT;
const oldSite = "https://198.244.191.182 {";
const newSite = host + " {";
const oldProxy = "    reverse_proxy 127.0.0.1:8788";
const newProxy = "    reverse_proxy 127.0.0.1:" + port;
const lines = source.split(/\r?\n/);
const count = needle => lines.filter(line => line === needle).length;
const currentTarget = count(newSite) === 1 && count(newProxy) === 1 && count(oldSite) === 0;
if (currentTarget) {
  if (count("    reverse_proxy 127.0.0.1:8788") !== 0) throw new Error("target Caddy config still references the private gateway");
  writeFileSync(process.env.CADDY_DEST, source, "utf8");
} else {
  if (count(oldSite) !== 1 || count(oldProxy) !== 1 || count(newSite) !== 0) {
    throw new Error("existing Caddy config is not the expected single IP-site/private-upstream topology");
  }
  if (lines.filter(line => /^\s*reverse_proxy\s+/.test(line)).length !== 1) {
    throw new Error("existing Caddy config contains unexpected additional upstreams");
  }
  const result = source.replace(oldSite, newSite).replace(oldProxy, newProxy);
  if (result === source || result.includes("127.0.0.1:8788")) {
    throw new Error("candidate did not replace the private upstream");
  }
  writeFileSync(process.env.CADDY_DEST, result, "utf8");
}
NODE

candidate_sha="$(sha256sum "$candidate" | awk '{print $1}')"
current_sha="$(sudo -n sha256sum "$ROOT_FILE" | awk '{print $1}')"
if [[ "$current_sha" != "$original_sha" ]]; then
  echo "Caddy config changed concurrently; refusing to overwrite it." >&2
  exit 2
fi

# Validate the candidate with the actual Caddy binary in the actual container.
"${DOCKER[@]}" cp "$candidate" "$CONTAINER_NAME:$container_candidate"
"${DOCKER[@]}" exec "$CONTAINER_NAME" caddy validate --config "$container_candidate" --adapter caddyfile >/dev/null

if [[ "$candidate_sha" == "$original_sha" ]]; then
  "${DOCKER[@]}" exec "$CONTAINER_NAME" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
else
  # Recheck the mount/network topology and source checksum immediately before atomic promotion.
  [[ "$(inspect_topology)" == "$expected_topology" ]] || {
    echo "Docker Caddy topology changed during validation; refusing promotion." >&2
    exit 2
  }
  current_sha="$(sudo -n sha256sum "$ROOT_FILE" | awk '{print $1}')"
  [[ "$current_sha" == "$original_sha" ]] || {
    echo "Caddy config changed during validation; refusing promotion." >&2
    exit 2
  }
  promoted=1
  write_config_in_place "$candidate"
  "${DOCKER[@]}" restart --time 10 "$CONTAINER_NAME" >/dev/null
fi

running=0
for _ in $(seq 1 30); do
  if "${DOCKER[@]}" inspect --format '{{.State.Running}}' "$CONTAINER_NAME" | grep -Fxq true; then
    running=1
    break
  fi
  sleep 1
done
[[ "$running" == "1" ]] || { echo "Docker Caddy did not return to running state" >&2; exit 2; }
"${DOCKER[@]}" exec "$CONTAINER_NAME" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

tls_health="$tmp_dir/tls-health.json"
tls_ok=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl --fail --silent --show-error --connect-timeout 3 --max-time 8 \
    --resolve "$host:443:127.0.0.1" "https://$host/health" > "$tls_health" 2>/dev/null; then
    if node --input-type=module - "$tls_health" <<'NODE'
import { readFileSync } from "node:fs";
const value = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (value?.ok !== true || value?.service !== "zssh") process.exit(1);
NODE
    then
      tls_ok=1
      break
    fi
  fi
  sleep 2
done
[[ "$tls_ok" == "1" ]] || { echo "HTTPS health verification failed for $host; transaction will roll back" >&2; exit 2; }

committed=1
printf 'ZSSH_PUBLIC_CADDY_DOCKER_INSTALL_GREEN host=%s port=%s release_sha=%s config_sha256=%s container=%s\n' \
  "$host" "$PORT_VALUE" "$REPO_SHA" "$(sudo -n sha256sum "$ROOT_FILE" | awk '{print $1}')" "$CONTAINER_NAME"
