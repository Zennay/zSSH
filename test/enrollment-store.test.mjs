import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { EnrollmentStore, canonicalEnrollmentClaim, normalizeTargetLabel } from "../enrollment-store.mjs";

const OWNER = "zssh_" + "a".repeat(32);
const OTHER = "zssh_" + "b".repeat(32);

async function tempStore(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zssh-enroll-"));
  const env = { ZSSH_ENROLLMENT_FILE: path.join(dir, "state", "enrollments.json"), ...(options.env || {}) };
  return new EnrollmentStore({ ...options, env });
}

function claimFor(code, label) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const targetId = "zt_" + crypto.randomBytes(12).toString("base64url");
  const nonce = "nonce_" + crypto.randomBytes(18).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(canonicalEnrollmentClaim({ code, targetId, nonce })), privateKey)
    .toString("base64url");
  return { code, targetId, nonce, signature, label, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) };
}

test("redeeming a one-use code links the server immediately by default", async () => {
  const store = await tempStore();
  const { enrollment_code } = await store.issue(OWNER);
  const claim = claimFor(enrollment_code, "web-1");
  const result = await store.claim(claim);
  assert.equal(result.connected, true);
  assert.equal(result.label, "web-1");
  const listed = await store.list(OWNER);
  assert.deepEqual(listed.map(t => [t.target_id, t.label]), [[claim.targetId, "web-1"]]);
  assert.ok(await store.trustedTarget(claim.targetId));
  assert.deepEqual(await store.list(OTHER), []);
  await assert.rejects(store.claim(claim), /expired or already redeemed/);
});

test("ZSSH_ENROLLMENT_REQUIRE_APPROVAL keeps the fingerprint confirmation step", async () => {
  const store = await tempStore({ env: { ZSSH_ENROLLMENT_REQUIRE_APPROVAL: "1" } });
  const { enrollment_code } = await store.issue(OWNER);
  const claim = claimFor(enrollment_code, "db");
  const result = await store.claim(claim);
  assert.equal(result.awaiting_approval, true);
  assert.equal(await store.trustedTarget(claim.targetId), null);
  const [pending] = await store.pending(OWNER);
  assert.equal(pending.label, "db");
  await store.approve({ profileId: OWNER, targetId: claim.targetId, fingerprint: result.fingerprint });
  assert.equal((await store.list(OWNER))[0].label, "db");
});

test("a forged signature never links a server", async () => {
  const store = await tempStore();
  const { enrollment_code } = await store.issue(OWNER);
  const claim = claimFor(enrollment_code, "x");
  claim.signature = claimFor(enrollment_code, "x").signature;
  await assert.rejects(store.claim(claim), /proof failed/);
  assert.deepEqual(await store.list(OWNER), []);
});

test("plan server limits block new codes and new links", async () => {
  const store = await tempStore({ targetLimit: async () => 1 });
  const first = await store.issue(OWNER);
  const second = await store.issue(OWNER);
  await store.claim(claimFor(first.enrollment_code, "a"));
  await assert.rejects(store.claim(claimFor(second.enrollment_code, "b")), /server limit/);
  await assert.rejects(store.issue(OWNER), /server limit/);
});

test("resolve picks the only server, or one by name or id", async () => {
  const store = await tempStore();
  await assert.rejects(store.resolve(OWNER), /No server is linked/);
  const a = claimFor((await store.issue(OWNER)).enrollment_code, "web-1");
  await store.claim(a);
  assert.equal((await store.resolve(OWNER)).target_id, a.targetId);
  const b = claimFor((await store.issue(OWNER)).enrollment_code, "db-1");
  await store.claim(b);
  await assert.rejects(store.resolve(OWNER), /pass target/);
  assert.equal((await store.resolve(OWNER, "DB-1")).target_id, b.targetId);
  assert.equal((await store.resolve(OWNER, a.targetId)).target_id, a.targetId);
  await assert.rejects(store.resolve(OTHER, a.targetId), /No server is linked|No linked server/);
  await store.rename(OWNER, b.targetId, "database");
  assert.equal((await store.resolve(OWNER, "database")).target_id, b.targetId);
  await store.revoke(OWNER, a.targetId);
  assert.equal((await store.resolve(OWNER)).target_id, b.targetId);
});

test("server labels are cosmetic and strictly bounded", () => {
  assert.equal(normalizeTargetLabel("web-1.prod"), "web-1.prod");
  assert.equal(normalizeTargetLabel("../etc"), null);
  assert.equal(normalizeTargetLabel("<script>"), null);
  assert.equal(normalizeTargetLabel("x".repeat(65)), null);
});
