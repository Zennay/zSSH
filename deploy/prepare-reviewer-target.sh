#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="${1:-}"
if [[ -z "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing to prepare a zSSH reviewer target as root." >&2
  exit 2
fi

for required in scripts/prepare-review-target.mjs scripts/reviewer-fixture-contract.mjs scripts/create-agent-identity.mjs package.json; do
  [[ -f "$SOURCE_ROOT/$required" ]] || { echo "Missing $required" >&2; exit 2; }
done

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "Node.js is required" >&2; exit 2; }

REVIEW_ROOT="${ZSSH_REVIEW_ROOT:-$HOME/zssh-review}"
KEY_FILE="${ZSSH_REVIEW_AGENT_KEY_FILE:-$HOME/.config/zssh/agent-ed25519.pem}"
PUBLIC_FILE="${ZSSH_REVIEW_AGENT_PUBLIC_FILE:-$HOME/.config/zssh/reviewer-agent-public.json}"
TARGET_ID="${ZSSH_REVIEW_TARGET_ID:-}"

case "$REVIEW_ROOT" in
  /*) ;;
  *) echo "ZSSH_REVIEW_ROOT must be absolute" >&2; exit 2 ;;
esac
case "$KEY_FILE" in
  /*) ;;
  *) echo "ZSSH_REVIEW_AGENT_KEY_FILE must be absolute" >&2; exit 2 ;;
esac
case "$PUBLIC_FILE" in
  /*) ;;
  *) echo "ZSSH_REVIEW_AGENT_PUBLIC_FILE must be absolute" >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$KEY_FILE")" "$(dirname "$PUBLIC_FILE")"
chmod 700 "$(dirname "$KEY_FILE")"

tmp_fixture="$(mktemp)"
tmp_identity="$(mktemp)"
trap 'rm -f "$tmp_fixture" "$tmp_identity"' EXIT

"$NODE_BIN" "$SOURCE_ROOT/scripts/prepare-review-target.mjs" --root "$REVIEW_ROOT" > "$tmp_fixture"

if [[ -e "$KEY_FILE" || -e "$PUBLIC_FILE" ]]; then
  if [[ ! -f "$KEY_FILE" || ! -f "$PUBLIC_FILE" ]]; then
    echo "Reviewer identity is incomplete; both private key and public config must exist or neither may exist." >&2
    exit 3
  fi
else
  "$NODE_BIN" "$SOURCE_ROOT/scripts/create-agent-identity.mjs" "$TARGET_ID" "$KEY_FILE" > "$tmp_identity"
  "$NODE_BIN" --input-type=module - "$tmp_identity" "$PUBLIC_FILE" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [source, target] = process.argv.slice(2);
const report = JSON.parse(readFileSync(source, "utf8"));
writeFileSync(target, JSON.stringify(report.gateway_public_key_config, null, 2) + "\n", { mode: 0o600 });
NODE
fi

# PR #56 originally persisted a wrapper around gateway_public_key_config.
# Normalize that already-deployed shape in place without rotating the key.
"$NODE_BIN" --input-type=module - "$PUBLIC_FILE" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [file] = process.argv.slice(2);
const parsed = JSON.parse(readFileSync(file, "utf8"));
const config = parsed?.gateway_public_key_config ?? parsed;
if (config?.version !== 1 || !config.targets || typeof config.targets !== "object" || Array.isArray(config.targets)) {
  throw new Error("reviewer gateway public-key config is invalid");
}
const entries = Object.entries(config.targets);
if (entries.length !== 1) throw new Error("reviewer gateway public-key config must contain exactly one target");
writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
NODE

chmod 600 "$KEY_FILE" "$PUBLIC_FILE"
chmod 700 "$REVIEW_ROOT"
chmod 600 "$REVIEW_ROOT/sample.txt"

"$NODE_BIN" --input-type=module - "$tmp_fixture" "$PUBLIC_FILE" "$KEY_FILE" "$SOURCE_ROOT/scripts/reviewer-fixture-contract.mjs" <<'NODE'
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [fixtureFile, publicFile, privateKeyFile, fixtureContractFile] = process.argv.slice(2);
const { reviewerFixtureReleaseMetadata } = await import(pathToFileURL(fixtureContractFile).href);
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
const pub = JSON.parse(readFileSync(publicFile, "utf8"));
const targetId = String(Object.keys(pub.targets || {})[0] || "");
const record = pub.targets?.[targetId];
if (!/^zt_[A-Za-z0-9_-]{8,96}$/.test(targetId)) throw new Error("reviewer target id is invalid");
if (!record?.public_key_pem?.includes("BEGIN PUBLIC KEY")) throw new Error("reviewer public key config is invalid");

const fingerprint = crypto.createHash("sha256").update(record.public_key_pem).digest("hex");
const release = reviewerFixtureReleaseMetadata({
  reviewFile: fixture.sample_file,
  reviewWriteFile: fixture.write_test_file,
});
const requireReleaseCompatible = process.env.ZSSH_REVIEW_REQUIRE_RELEASE_COMPATIBLE === "1";
if (requireReleaseCompatible && !release.release_compatible) {
  throw new Error(release.release_blocker || "reviewer fixture is not release-compatible");
}
console.log(JSON.stringify({
  ok: true,
  target_id: targetId,
  public_key_sha256: fingerprint,
  gateway_public_key_config_file: publicFile,
  private_key_file: privateKeyFile,
  private_key_printed: false,
  review_root: fixture.review_root,
  review_file: fixture.sample_file,
  review_write_file: fixture.write_test_file,
  release_guard_enforced: requireReleaseCompatible,
  ...release,
}, null, 2));
NODE
