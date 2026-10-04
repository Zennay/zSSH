import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPairingStatus, listPairings } from "../pairing.mjs";
import { executeAgentPairingControl } from "../agent-pairing-control.mjs";

function auth(subject) {
  return {
    clientId: subject,
    scopes: ["zssh:read", "zssh:write"],
    extra: {
      sub: subject,
      issuer: "https://auth.example",
    },
  };
}

test("signed target pairing control is isolated by target id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-pairing-"));
  const env = {
    ZSSH_PAIRING_FILE: path.join(root, "pairings.json"),
    ZSSH_PAIRING_REQUEST_TTL_SECONDS: "900",
  };
  const resource = "https://mcp.example";
  const targetA = "zt_targetalpha1";
  const targetB = "zt_targetbravo2";

  try {
    const requestA = await getPairingStatus(auth("alice"), {
      resource,
      createRequest: true,
      targetId: targetA,
      env,
    });
    const requestB = await getPairingStatus(auth("bob"), {
      resource,
      createRequest: true,
      targetId: targetB,
      env,
    });

    const visibleA = await executeAgentPairingControl({
      pathname: "/agent/v1/pairings",
      targetId: targetA,
      body: {},
      env,
    });
    assert.deepEqual(visibleA.requests.map(value => value.request_id), [requestA.request_id]);
    assert.equal(JSON.stringify(visibleA).includes("alice"), false);

    await assert.rejects(
      executeAgentPairingControl({
        pathname: "/agent/v1/pairing/approve",
        targetId: targetB,
        body: { request_id: requestA.request_id },
        env,
      }),
      /different target/,
    );

    const approvedA = await executeAgentPairingControl({
      pathname: "/agent/v1/pairing/approve",
      targetId: targetA,
      body: { request_id: requestA.request_id },
      env,
    });
    assert.equal(approvedA.paired, true);
    assert.equal(approvedA.target_id, targetA);

    const wrongTargetRevoke = await executeAgentPairingControl({
      pathname: "/agent/v1/pairing/revoke",
      targetId: targetB,
      body: { profile_id: approvedA.profile_id },
      env,
    });
    assert.equal(wrongTargetRevoke.revoked, false);
    assert.equal(wrongTargetRevoke.target_id, targetB);

    const revokedA = await executeAgentPairingControl({
      pathname: "/agent/v1/pairing/revoke",
      targetId: targetA,
      body: { profile_id: approvedA.profile_id },
      env,
    });
    assert.equal(revokedA.revoked, true);
    assert.equal(revokedA.revoked_count, 1);
    assert.equal(revokedA.target_id, targetA);

    const visibleB = await listPairings({ targetId: targetB, env });
    assert.deepEqual(visibleB.requests.map(value => value.request_id), [requestB.request_id]);
    assert.equal(visibleB.pairings.some(value => value.profile_id === approvedA.profile_id), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pairing control rejects malformed identifiers before registry mutation", async () => {
  await assert.rejects(
    executeAgentPairingControl({
      pathname: "/agent/v1/pairing/approve",
      targetId: "zt_targetalpha1",
      body: { request_id: "../pairings.json" },
      env: { ZSSH_PAIRING_FILE: "/tmp/unused-zssh-pairing-test.json" },
    }),
    /invalid pairing request id/,
  );

  await assert.rejects(
    executeAgentPairingControl({
      pathname: "/agent/v1/pairing/revoke",
      targetId: "zt_targetalpha1",
      body: { profile_id: "alice@example.com" },
      env: { ZSSH_PAIRING_FILE: "/tmp/unused-zssh-pairing-test.json" },
    }),
    /invalid pairing profile id/,
  );
});
