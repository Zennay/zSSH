#!/usr/bin/env node
// Target-side half of the personal one-command enrollment. The one-time code
// arrives on stdin (not argv, a file, a URL, or the agent environment).
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { canonicalEnrollmentClaim } from "../enrollment-store.mjs";
import { normalizeTargetId } from "../pairing.mjs";

function fail(message) {
  throw new Error(message);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--gateway") {
  fail("usage: node scripts/enroll-target.mjs --gateway https://trusted-zssh-gateway (personal code on stdin)");
}
if (typeof process.getuid !== "function" || process.getuid() === 0) {
  fail("enrollment must run as the unprivileged zssh account");
}
const url = new URL(args[1]);
if (
  url.protocol !== "https:" || url.username || url.password ||
  url.pathname !== "/" || url.search || url.hash || url.port ||
  !url.hostname.includes(".") || url.hostname === "localhost"
) {
  fail("gateway must be a trusted HTTPS DNS origin with no path, credentials, or port");
}

let code = "";
for await (const chunk of process.stdin) {
  code += chunk.toString("utf8");
  if (code.length > 128) fail("enrollment input too long");
}
code = code.trim();
if (!/^enr_[A-Za-z0-9_-]{43}$/.test(code)) fail("invalid one-use enrollment code");

const dir = path.join(os.homedir(), ".config", "zssh");
const keyFile = path.join(dir, "agent-ed25519.pem");
const idFile = path.join(dir, "agent-identity.json");
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const directory = await fs.lstat(dir);
if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
  fail("agent identity directory must be private");
}

async function existing(file) {
  try { return await fs.lstat(file); } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

const keyStat = await existing(keyFile);
const identityStat = await existing(idFile);
if (Boolean(keyStat) !== Boolean(identityStat)) {
  fail("partial existing agent identity: refusing to rotate or overwrite key");
}
let targetId, privateKey;
if (keyStat) {
  for (const st of [keyStat, identityStat]) {
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid()) {
      fail("existing agent key and identity must be private regular files owned by zssh");
    }
  }
  const metadata = JSON.parse(await fs.readFile(idFile, "utf8"));
  targetId = normalizeTargetId(metadata.target_id);
  if (targetId === "local") fail("non-local target id required");
  privateKey = crypto.createPrivateKey(await fs.readFile(keyFile, "utf8"));
} else {
  targetId = "zt_" + crypto.randomBytes(12).toString("base64url");
  const generated = crypto.generateKeyPairSync("ed25519");
  privateKey = generated.privateKey;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  await fs.writeFile(keyFile, keyPem, { flag: "wx", mode: 0o600 });
  await fs.writeFile(idFile, JSON.stringify({ version: 1, target_id: targetId }) + "\n", {
    flag: "wx", mode: 0o600,
  });
}
if (privateKey.asymmetricKeyType !== "ed25519") fail("agent must use Ed25519");
const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
const nonce = "nonce_" + crypto.randomBytes(18).toString("base64url");
const signature = crypto.sign(null, Buffer.from(canonicalEnrollmentClaim({ code, targetId, nonce })), privateKey)
  .toString("base64url");

const response = await fetch(url.origin + "/enrollment/v1/claim", {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/json", "accept": "application/json" },
  body: JSON.stringify({ code, targetId, publicKeyPem, nonce, signature }),
  signal: AbortSignal.timeout(15000),
});
// The remote service should never echo the submitted code; never print raw
// response bodies, redirects, or any secret-bearing input even on errors.
if (response.status !== 202) fail("zSSH enrollment gateway rejected claim (HTTP " + response.status + ")");
const result = await response.json();
const expectedFingerprint = "SHA256:" + crypto.createHash("sha256")
  .update(crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }))
  .digest("base64").replace(/=+$/, "");
if (
  (result?.awaiting_approval !== true && result?.approved !== true) ||
  result?.target_id !== targetId ||
  result?.fingerprint !== expectedFingerprint
) {
  fail("gateway enrollment identity confirmation mismatch");
}
console.log("ZSSH_ENROLLMENT_CLAIM_ACCEPTED target=" + targetId);
console.log("ZSSH_TARGET_FINGERPRINT " + expectedFingerprint);
if (result.approved === true) {
  console.log("ZSSH_ENROLLMENT_APPROVED: permanent Ed25519 host identity registered.");
} else {
  console.log("Approve this fingerprint in your zSSH ChatGPT plugin. Do not share the enrollment command.");
}
