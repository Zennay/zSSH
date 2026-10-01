import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  approvePairing,
  getPairingStatus,
  listPairings,
  profileIdFromAuth,
  revokePairing,
} from "../pairing.mjs";

function auth(subject = "user-123") {
  return {
    clientId: subject,
    scopes: ["zssh:read", "zssh:write"],
    extra: {
      sub: subject,
      issuer: "https://auth.example",
    },
  };
}

test("profile id is stable for the same OAuth identity and resource", () => {
  const a = profileIdFromAuth(auth("alice"), "https://mcp.example");
  const b = profileIdFromAuth(auth("alice"), "https://mcp.example");
  const c = profileIdFromAuth(auth("bob"), "https://mcp.example");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^zssh_[a-f0-9]{32}$/);
});

test("pairing request can be approved and revoked without storing raw OAuth subject", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-pairing-test-"));
  const file = path.join(root, "pairings.json");
  const env = {
    ZSSH_PAIRING_FILE: file,
    ZSSH_PAIRING_REQUEST_TTL_SECONDS: "900",
  };
  const resource = "https://mcp.example";
  const identity = auth("sensitive-subject-value");

  try {
    const first = await getPairingStatus(identity, {
      resource,
      createRequest: true,
      env,
      now: Date.parse("2026-10-01T07:00:00Z"),
    });
    assert.equal(first.paired, false);
    assert.equal(first.pending, true);
    assert.match(first.request_id, /^pair_[a-f0-9]{24}$/);

    const onDisk = await readFile(file, "utf8");
    assert.doesNotMatch(onDisk, /sensitive-subject-value/);

    const approved = await approvePairing(first.request_id, {
      env,
      now: Date.parse("2026-10-01T07:01:00Z"),
    });
    assert.equal(approved.paired, true);
    assert.equal(approved.profile_id, first.profile_id);

    const paired = await getPairingStatus(identity, {
      resource,
      env,
      now: Date.parse("2026-10-01T07:02:00Z"),
    });
    assert.equal(paired.paired, true);
    assert.equal(paired.pending, false);

    const revoked = await revokePairing(first.profile_id, {
      env,
      now: Date.parse("2026-10-01T07:03:00Z"),
    });
    assert.equal(revoked.revoked, true);

    const after = await getPairingStatus(identity, {
      resource,
      env,
      now: Date.parse("2026-10-01T07:04:00Z"),
    });
    assert.equal(after.paired, false);
    assert.ok(after.revoked_at);

    const listed = await listPairings({ env, now: Date.parse("2026-10-01T07:04:00Z") });
    assert.equal(listed.pairings.length, 1);
    assert.equal(listed.pairings[0].active, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired pairing requests cannot be approved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-pairing-expiry-"));
  const env = {
    ZSSH_PAIRING_FILE: path.join(root, "pairings.json"),
    ZSSH_PAIRING_REQUEST_TTL_SECONDS: "60",
  };

  try {
    const request = await getPairingStatus(auth("alice"), {
      resource: "https://mcp.example",
      createRequest: true,
      env,
      now: Date.parse("2026-10-01T07:00:00Z"),
    });
    await assert.rejects(
      () => approvePairing(request.request_id, {
        env,
        now: Date.parse("2026-10-01T07:02:00Z"),
      }),
      /not found or expired/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
