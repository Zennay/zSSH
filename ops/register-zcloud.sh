#!/usr/bin/env bash
set -Eeuo pipefail

ZCLOUD_CANONICAL_SHA="${ZCLOUD_CANONICAL_SHA:-${1:-}}"
if [[ -z "$ZCLOUD_CANONICAL_SHA" ]]; then
  echo "Usage: ZCLOUD_CANONICAL_SHA=<sha> $0  (or pass SHA as first argument)" >&2
  exit 2
fi

test "$(id -un)" = "ubuntu"

LIVE_ROOT="/home/ubuntu/zennay-cloud"
STATE_DIR="/home/ubuntu/.local/state/zcloud/recovery"
CANDIDATE="$(mktemp -d /tmp/zssh-zcloud-register.XXXXXX)"
POST_CAPTURE="$(mktemp /tmp/zssh-postdeploy.XXXXXX.json)"
POST_WRAPPER="$(mktemp /tmp/zssh-postdeploy-wrapper.XXXXXX)"
trap 'rm -rf "$CANDIDATE" "$POST_CAPTURE" "$POST_WRAPPER"' EXIT

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
test -S "$XDG_RUNTIME_DIR/bus"

echo "::group::Verify live zSSH runtime"
curl -fsS http://127.0.0.1:8788/health
systemctl --user is-active --quiet zssh.service
echo "ZSSH_RUNTIME_GREEN"
echo "::endgroup::"

echo "::group::Fetch exact canonical zCloud revision"
git clone --filter=blob:none --no-checkout https://github.com/Zennay/zCloud.git "$CANDIDATE"
git -C "$CANDIDATE" fetch --depth 1 origin "$ZCLOUD_CANONICAL_SHA"
git -C "$CANDIDATE" checkout --detach "$ZCLOUD_CANONICAL_SHA"
test "$(git -C "$CANDIDATE" rev-parse HEAD)" = "$ZCLOUD_CANONICAL_SHA"
echo "::endgroup::"

echo "::group::Require clean zCloud prechange"
/home/ubuntu/.local/bin/zcloud-prechange-guard   --root "$LIVE_ROOT"   --state "$STATE_DIR"
echo "::endgroup::"

cat > "$POST_WRAPPER" <<EOF
#!/usr/bin/env bash
set +e
"$CANDIDATE/scripts/zcloud_postdeploy_canary.py" "\$@" > "$POST_CAPTURE"
rc=\$?
cat "$POST_CAPTURE"
exit \$rc
EOF
chmod 700 "$POST_WRAPPER"

echo "::group::Promote zCloud zSSH registration"
python3 "$CANDIDATE/scripts/zcloud_transactional_promote.py"   --candidate "$CANDIDATE"   --root "$LIVE_ROOT"   --state "$STATE_DIR"   --path projects.json   --path project-layout.json   --actor zssh-register-zcloud   --require-incidents   --postdeploy "$POST_WRAPPER"
echo "::endgroup::"

echo "::group::Final integration proof"
cat "$POST_CAPTURE"
curl -fsS http://127.0.0.1:8788/health
systemctl --user is-active --quiet zssh.service

python3 - <<'PY'
import json, urllib.request
with urllib.request.urlopen("http://127.0.0.1:8765/api/status", timeout=5) as response:
    data=json.load(response)
projects=data.get("projects") or []
match=[p for p in projects if p.get("id")=="zssh"]
assert match, "zssh missing from live zCloud status"
print("ZCLOUD_ZSSH_CARD_GREEN", match[0].get("progress"))
PY

echo "ZSSH_ZCLOUD_REGISTRATION_GREEN"
echo "::endgroup::"
