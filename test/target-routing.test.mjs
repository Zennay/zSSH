import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  approvePairing,
  getPairingStatus,
  profileIdFromAuth,
  revokePairing,
} from "../pairing.mjs";
import {
  TargetSessionRegistry,
  newTargetSessionId,
  resolveAuthenticatedTarget,
} from "../target-routing.mjs";

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

test("target-aware pairing binds one OAuth profile to one opaque target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-route-pairing-"));
  const file = path.join(root, "pairings.json");
  const resource = "https://mcp.example";
  const identity = auth("alice");
  const envA = { ZSSH_PAIRING_FILE: file, ZSSH_TARGET_ID: "zt_targetA123" };
  const envB = { ZSSH_PAIRING_FILE: file, ZSSH_TARGET_ID: "zt_targetB456" };

  try {
    const request = await getPairingStatus(identity, {
      resource,
      createRequest: true,
      env: envA,
      now: Date.parse("2026-10-03T20:00:00Z"),
    });
    assert.equal(request.target_id, "zt_targetA123");

    const approved = await approvePairing(request.request_id, {
      env: envA,
      now: Date.parse("2026-10-03T20:01:00Z"),
    });
    assert.equal(approved.target_id, "zt_targetA123");

    const pairedA = await getPairingStatus(identity, { resource, env: envA });
    const pairedB = await getPairingStatus(identity, { resource, env: envB });
    assert.equal(pairedA.paired, true);
    assert.equal(pairedB.paired, false);
    assert.equal(pairedB.target_id, "zt_targetB456");

    const onDisk = JSON.parse(await readFile(file, "utf8"));
    const stored = JSON.stringify(onDisk);
    assert.doesNotMatch(stored, /alice/);
    assert.match(stored, /zt_targetA123/);
    assert.doesNotMatch(stored, /https?:\/\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy profile-only pairing remains valid only for local target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-route-legacy-"));
  const file = path.join(root, "pairings.json");
  const resource = "https://mcp.example";
  const identity = auth("legacy-user");
  const profileId = profileIdFromAuth(identity, resource);

  try {
    await writeFile(file, JSON.stringify({
      version: 1,
      pairings: {
        [profileId]: {
          paired_at: "2026-10-01T00:00:00.000Z",
          revoked_at: null,
        },
      },
      requests: {},
    }));

    const local = await getPairingStatus(identity, {
      resource,
      env: { ZSSH_PAIRING_FILE: file },
    });
    const remote = await getPairingStatus(identity, {
      resource,
      targetId: "zt_remote1234",
      env: { ZSSH_PAIRING_FILE: file },
    });

    assert.equal(local.paired, true);
    assert.equal(local.target_id, "local");
    assert.equal(remote.paired, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("router resolves only a paired target with a live authenticated session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-route-live-"));
  const file = path.join(root, "pairings.json");
  const env = { ZSSH_PAIRING_FILE: file, ZSSH_TARGET_ID: "zt_live12345" };
  const resource = "https://mcp.example";
  const identity = auth("route-user");
  const sessions = new TargetSessionRegistry();

  try {
    const request = await getPairingStatus(identity, { resource, createRequest: true, env });
    await approvePairing(request.request_id, { env });

    const offline = await resolveAuthenticatedTarget(identity, { resource, env, sessions });
    assert.deepEqual(
      { routable: offline.routable, reason: offline.reason, target_id: offline.target_id },
      { routable: false, reason: "target_offline", target_id: "zt_live12345" },
    );

    const sent = [];
    const sessionId = newTargetSessionId();
    sessions.register({
      targetId: "zt_live12345",
      sessionId,
      transport: async payload => {
        sent.push(payload);
        return { ok: true };
      },
    });

    const routed = await resolveAuthenticatedTarget(identity, { resource, env, sessions });
    assert.equal(routed.routable, true);
    assert.equal(routed.target_id, "zt_live12345");
    assert.equal(routed.session_id, sessionId);
    await routed.send({ tool: "get_system_uptime" });
    assert.deepEqual(sent, [{ tool: "get_system_uptime" }]);

    const snapshot = JSON.stringify(sessions.snapshot());
    assert.doesNotMatch(snapshot, /transport|function|secret|https?:\/\//i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation immediately makes an otherwise live target unroutable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-route-revoke-"));
  const file = path.join(root, "pairings.json");
  const env = { ZSSH_PAIRING_FILE: file, ZSSH_TARGET_ID: "zt_revoke123" };
  const resource = "https://mcp.example";
  const identity = auth("revoke-user");
  const sessions = new TargetSessionRegistry();

  try {
    const request = await getPairingStatus(identity, { resource, createRequest: true, env });
    const approved = await approvePairing(request.request_id, { env });
    sessions.register({
      targetId: approved.target_id,
      sessionId: "sess_abcdefghijklmnop",
      transport: async () => ({ ok: true }),
    });

    const before = await resolveAuthenticatedTarget(identity, { resource, env, sessions });
    assert.equal(before.routable, true);

    const revoked = await revokePairing(approved.profile_id, {
      targetId: approved.target_id,
      env,
    });
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.target_id, approved.target_id);

    const after = await resolveAuthenticatedTarget(identity, { resource, env, sessions });
    assert.equal(after.routable, false);
    assert.equal(after.reason, "not_paired");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session replacement is target-local and stale disconnect cannot remove replacement", () => {
  const sessions = new TargetSessionRegistry();
  const first = sessions.register({
    targetId: "zt_shared123",
    sessionId: "sess_firstsession123",
    transport: async () => "first",
  });
  const second = sessions.register({
    targetId: "zt_shared123",
    sessionId: "sess_secondsession12",
    transport: async () => "second",
  });

  assert.notEqual(first.session_id, second.session_id);
  assert.equal(sessions.unregister("zt_shared123", first.session_id), false);
  assert.equal(sessions.resolve("zt_shared123").session_id, second.session_id);
  assert.equal(sessions.unregister("zt_shared123", second.session_id), true);
  assert.equal(sessions.resolve("zt_shared123"), null);
});
