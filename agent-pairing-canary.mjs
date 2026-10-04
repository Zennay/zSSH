import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPairingStatus } from "./pairing.mjs";
import { signAgentRequest } from "./agent-transport.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-pairing-http-"));
const pairingFile = path.join(root, "pairings.json");
const port = 18793;
const base = `http://127.0.0.1:${port}`;
const targetA = "zt_canaryalpha1";
const targetB = "zt_canarybravo2";
const keyA = crypto.generateKeyPairSync("ed25519");
const keyB = crypto.generateKeyPairSync("ed25519");

function publicPem(key) {
  return key.export({ type: "spki", format: "pem" });
}

const trust = {
  version: 1,
  targets: {
    [targetA]: { public_key_pem: publicPem(keyA.publicKey), enabled: true },
    [targetB]: { public_key_pem: publicPem(keyB.publicKey), enabled: true },
  },
};

const pairingEnv = {
  ZSSH_PAIRING_FILE: pairingFile,
  ZSSH_PAIRING_REQUEST_TTL_SECONDS: "900",
};

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    ZSSH_ALLOW_ROOT: "1",
    ZSSH_PLUGIN_PROFILE: "public",
    ZSSH_PUBLIC_AUTH_MODE: "legacy",
    ZSSH_EXEC_MODE: "disabled",
    ZSSH_TARGET_ID: targetA,
    ZSSH_AGENT_PUBLIC_KEYS_JSON: JSON.stringify(trust),
    ZSSH_AGENT_MAX_CLOCK_SKEW_MS: "60000",
    ...pairingEnv,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(base + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("zSSH agent pairing canary server did not start: " + stderr);
}

async function signedPost(targetId, privateKey, pathname, value) {
  const body = JSON.stringify(value ?? {});
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce_" + crypto.randomBytes(18).toString("base64url");
  const signature = signAgentRequest(privateKey, {
    method: "POST",
    pathname,
    targetId,
    timestamp,
    nonce,
    body,
  });
  return await fetch(base + pathname, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zssh-agent-target": targetId,
      "x-zssh-agent-timestamp": timestamp,
      "x-zssh-agent-nonce": nonce,
      "x-zssh-agent-signature": signature,
    },
    body,
  });
}

const authInfo = {
  clientId: "agent-pairing-canary",
  scopes: ["zssh:read", "zssh:write"],
  extra: {
    sub: "agent-pairing-canary-user",
    issuer: "https://issuer.zssh.test",
  },
};

try {
  await waitForHealth();

  const unsigned = await fetch(base + "/agent/v1/pairings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (unsigned.status !== 401) throw new Error("unsigned pairing control did not fail closed");

  const pending = await getPairingStatus(authInfo, {
    resource: "https://mcp.zssh.test",
    createRequest: true,
    targetId: targetA,
    env: pairingEnv,
  });
  if (!pending.pending || !pending.request_id) throw new Error("pairing canary request was not created");

  const listAResponse = await signedPost(targetA, keyA.privateKey, "/agent/v1/pairings", {});
  if (!listAResponse.ok) throw new Error("target A pairing list failed");
  const listA = await listAResponse.json();
  if (listA.requests.length !== 1 || listA.requests[0].request_id !== pending.request_id) {
    throw new Error("target A did not see exactly its pending request");
  }

  const listBResponse = await signedPost(targetB, keyB.privateKey, "/agent/v1/pairings", {});
  if (!listBResponse.ok) throw new Error("target B pairing list failed");
  const listB = await listBResponse.json();
  if (listB.requests.length !== 0 || listB.pairings.length !== 0) {
    throw new Error("target B saw target A pairing state");
  }

  const crossApprove = await signedPost(targetB, keyB.privateKey, "/agent/v1/pairing/approve", {
    request_id: pending.request_id,
  });
  if (crossApprove.status !== 409) throw new Error("cross-target approval did not fail closed");

  const approveResponse = await signedPost(targetA, keyA.privateKey, "/agent/v1/pairing/approve", {
    request_id: pending.request_id,
  });
  if (!approveResponse.ok) throw new Error("target-local approval failed");
  const approved = await approveResponse.json();
  if (!approved.paired || approved.target_id !== targetA) throw new Error("approval result is not target-scoped");

  const paired = await getPairingStatus(authInfo, {
    resource: "https://mcp.zssh.test",
    targetId: targetA,
    env: pairingEnv,
  });
  if (!paired.paired) throw new Error("approved pairing did not become active");

  const crossRevokeResponse = await signedPost(targetB, keyB.privateKey, "/agent/v1/pairing/revoke", {
    profile_id: paired.profile_id,
  });
  if (!crossRevokeResponse.ok) throw new Error("cross-target revoke response failed unexpectedly");
  const crossRevoke = await crossRevokeResponse.json();
  if (crossRevoke.revoked) throw new Error("target B revoked target A pairing");

  const revokeResponse = await signedPost(targetA, keyA.privateKey, "/agent/v1/pairing/revoke", {
    profile_id: paired.profile_id,
  });
  if (!revokeResponse.ok) throw new Error("target-local revoke failed");
  const revoked = await revokeResponse.json();
  if (!revoked.revoked || revoked.target_id !== targetA) throw new Error("revoke result is not target-scoped");

  const after = await getPairingStatus(authInfo, {
    resource: "https://mcp.zssh.test",
    targetId: targetA,
    env: pairingEnv,
  });
  if (after.paired) throw new Error("revoked pairing remained active");

  console.log(JSON.stringify({
    ok: true,
    unsigned_blocked: true,
    target_list_isolated: true,
    cross_target_approve_blocked: true,
    target_approve_succeeded: true,
    cross_target_revoke_blocked: true,
    target_revoke_succeeded: true,
  }));
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
  }).catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
