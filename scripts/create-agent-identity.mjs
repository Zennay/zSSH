#!/usr/bin/env node
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { normalizeTargetId } from "../pairing.mjs";

function generateTargetId() {
  return "zt_" + crypto.randomBytes(12).toString("base64url");
}

function resolvePrivateKeyFile(value) {
  const raw = String(value || "").trim();
  return path.resolve(raw || path.join(os.homedir(), ".config", "zssh", "agent-ed25519.pem"));
}

const [targetArg, privateFileArg] = process.argv.slice(2);
const targetId = normalizeTargetId(targetArg || generateTargetId());
if (targetId === "local") {
  throw new Error("outbound agent identity requires an explicit opaque zt_ target id");
}
const privateKeyFile = resolvePrivateKeyFile(privateFileArg);

const dir = path.dirname(privateKeyFile);
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
await fs.chmod(dir, 0o700);

try {
  await fs.lstat(privateKeyFile);
  throw new Error("agent private key already exists; refusing to overwrite " + privateKeyFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });

const handle = await fs.open(privateKeyFile, "wx", 0o600);
try {
  await handle.writeFile(privatePem, "utf8");
} finally {
  await handle.close();
}
await fs.chmod(privateKeyFile, 0o600);

console.log(JSON.stringify({
  ok: true,
  target_id: targetId,
  private_key_file: privateKeyFile,
  private_key_printed: false,
  gateway_trust_record: {
    version: 1,
    targets: {
      [targetId]: {
        enabled: true,
        public_key_pem: publicPem,
      },
    },
  },
}, null, 2));
