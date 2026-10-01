import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { approvePairing, listPairings, revokePairing } from "./pairing.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "zssh-pairing-canary-"));
const pairingFile = path.join(root, "pairings.json");
const port = 18791;
const jwksPort = 18792;
const resource = `http://127.0.0.1:${port}`;
const issuer = "https://issuer.zssh.test";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "zssh-pairing-canary";
jwk.use = "sig";
jwk.alg = "RS256";

const jwksServer = createHttpServer((req, res) => {
  if (req.url !== "/jwks") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise(resolve => jwksServer.listen(jwksPort, "127.0.0.1", resolve));

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
    ZSSH_PLUGIN_PROFILE: "public",
    ZSSH_PUBLIC_AUTH_MODE: "oauth",
    ZSSH_EXEC_MODE: "disabled",
    ZSSH_PUBLIC_ALLOWED_ROOTS: root,
    ZSSH_ALLOWED_ROOTS: root,
    ZSSH_AUDIT_LOG: path.join(root, "audit.jsonl"),
    ZSSH_PUBLIC_BASE_URL: resource,
    ZSSH_OAUTH_ISSUER: issuer,
    ZSSH_OAUTH_JWKS_URI: `http://127.0.0.1:${jwksPort}/jwks`,
    ZSSH_OAUTH_SCOPES: "zssh:read zssh:write",
    ZSSH_TARGET_LABEL: "Review target",
    ...pairingEnv,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(resource + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("zSSH pairing canary server did not start: " + stderr);
}

const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ scope: "zssh:read zssh:write" })
  .setProtectedHeader({ alg: "RS256", kid: "zssh-pairing-canary" })
  .setIssuer(issuer)
  .setAudience(resource)
  .setSubject("pairing-canary-user")
  .setIssuedAt(now)
  .setExpirationTime(now + 300)
  .sign(privateKey);

const client = new Client({ name: "zssh-pairing-canary", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(resource + "/mcp"), {
  requestInit: {
    headers: { Authorization: "Bearer " + token },
  },
});

try {
  await waitForHealth();
  await client.connect(transport);

  const profileResult = await client.callTool({ name: "get_profile", arguments: {} });
  const profile = profileResult.structuredContent || JSON.parse(profileResult.content?.find(p => p.type === "text")?.text || "{}");
  if (!/^zssh_[a-f0-9]{32}$/.test(profile.id || "")) throw new Error("profile id is not stable/opaque");
  if (profile.nickname !== "Review target") throw new Error("profile nickname does not use operator target label");

  const blockedBefore = await client.callTool({ name: "get_system_uptime", arguments: {} });
  if (!blockedBefore.isError) throw new Error("unpaired system tool call was not blocked");
  const stateBeforeRequest = await listPairings({ env: pairingEnv });
  if (stateBeforeRequest.requests.length !== 0) {
    throw new Error("read-only target call created pairing state");
  }

  const statusResult = await client.callTool({ name: "get_pairing_status", arguments: {} });
  const status = statusResult.structuredContent || JSON.parse(statusResult.content?.find(p => p.type === "text")?.text || "{}");
  if (status.paired !== false || status.pending !== true || !status.request_id) {
    throw new Error("pairing request was not created by get_pairing_status");
  }

  await approvePairing(status.request_id, { env: pairingEnv });

  const allowed = await client.callTool({ name: "get_system_uptime", arguments: {} });
  const allowedValue = JSON.parse(allowed.content?.find(p => p.type === "text")?.text || "{}");
  if (allowed.isError || !allowedValue.ok) throw new Error("paired system tool call failed");

  const revoked = await revokePairing(profile.id, { env: pairingEnv });
  if (!revoked.revoked) throw new Error("pairing revoke did not change active state");

  const blockedAfter = await client.callTool({ name: "get_system_uptime", arguments: {} });
  if (!blockedAfter.isError) throw new Error("revoked profile retained tool access");

  console.log(JSON.stringify({
    ok: true,
    profile_id: profile.id,
    read_only_unpaired_side_effect_free: true,
    request_created: true,
    unpaired_blocked: true,
    paired_allowed: true,
    revoked_blocked: true,
  }));
} finally {
  await client.close().catch(() => {});
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve)).catch(() => {});
  await new Promise(resolve => jwksServer.close(resolve)).catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
