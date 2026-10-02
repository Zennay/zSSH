import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { approvePairing, getPairingStatus } from "./pairing.mjs";

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", code => resolve({ code, stdout, stderr }));
  });
}

const root = await mkdtemp(path.join(os.tmpdir(), "zssh-prod-probe-canary-"));
const pairingFile = path.join(root, "pairings.json");
const reviewRoot = path.join(root, "review");
const sampleFile = path.join(reviewRoot, "sample.txt");
const outputFile = path.join(reviewRoot, "output.txt");
const port = 18793;
const jwksPort = 18794;
const resource = `http://127.0.0.1:${port}`;
const issuer = `http://127.0.0.1:${jwksPort}`;
const challengeToken = "challenge-" + Date.now();

await mkdir(reviewRoot, { recursive: true });
await writeFile(sampleFile, "zSSH reviewer fixture\nstatus=ready\n", "utf8");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "zssh-prod-probe";
jwk.use = "sig";
jwk.alg = "RS256";

const jwksServer = createHttpServer((req, res) => {
  if (req.url === "/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  if (req.url === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      registration_endpoint: issuer + "/register",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    }));
  }
  return res.writeHead(404).end();
});
await new Promise(resolve => jwksServer.listen(jwksPort, "127.0.0.1", resolve));

const subject = "submission-reviewer";
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ scope: "zssh:read zssh:write" })
  .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
  .setIssuer(issuer)
  .setAudience(resource)
  .setSubject(subject)
  .setIssuedAt(now)
  .setExpirationTime(now + 300)
  .sign(privateKey);

const pairingEnv = {
  ZSSH_PAIRING_FILE: pairingFile,
  ZSSH_PAIRING_REQUEST_TTL_SECONDS: "900",
};
const authInfo = {
  clientId: subject,
  scopes: ["zssh:read", "zssh:write"],
  extra: { sub: subject, issuer },
};
const request = await getPairingStatus(authInfo, {
  resource,
  createRequest: true,
  env: pairingEnv,
});
await approvePairing(request.request_id, { env: pairingEnv });

const serverEnv = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(port),
  ZSSH_PLUGIN_PROFILE: "public",
  ZSSH_PUBLIC_AUTH_MODE: "oauth",
  ZSSH_EXEC_MODE: "disabled",
  ZSSH_PUBLIC_ALLOWED_ROOTS: reviewRoot,
  ZSSH_ALLOWED_ROOTS: reviewRoot,
  ZSSH_AUDIT_LOG: path.join(root, "audit.jsonl"),
  ZSSH_PUBLIC_BASE_URL: resource,
  ZSSH_OAUTH_ISSUER: issuer,
  ZSSH_OAUTH_JWKS_URI: `http://127.0.0.1:${jwksPort}/jwks`,
  ZSSH_OAUTH_SCOPES: "zssh:read zssh:write",
  ZSSH_TARGET_LABEL: "Submission review target",
  OPENAI_APPS_CHALLENGE_TOKEN: challengeToken,
  ...pairingEnv,
};

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: serverEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverStderr = "";
server.stderr.on("data", chunk => { serverStderr += chunk.toString("utf8"); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(resource + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("test zSSH server failed to start: " + serverStderr);
}

try {
  await waitForHealth();
  const result = await runChild(process.execPath, ["production-submission-probe.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ZSSH_PROBE_ALLOW_HTTP: "1",
      ZSSH_PLUGIN_MCP_URL: resource + "/mcp",
      ZSSH_REVIEW_ACCESS_TOKEN: token,
      ZSSH_REVIEW_FILE: sampleFile,
      ZSSH_REVIEW_WRITE_FILE: outputFile,
      OPENAI_APPS_CHALLENGE_TOKEN: challengeToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.code !== 0) {
    throw new Error("production probe failed: " + result.stderr + "\n" + result.stdout);
  }
  const report = JSON.parse(result.stdout);
  if (!report.ok || !report.annotations_validated || !report.review_file_write_roundtrip_green || !report.no_redirect_contract_validated || !report.listing_urls_validated || !report.exact_resource_metadata_challenge_validated || !report.oauth_authorization_server_metadata_validated || !report.oauth_pkce_s256_validated || !/^[a-f0-9]{64}$/.test(String(report.tool_scan_sha256 || ""))) {
    throw new Error("production probe did not report all green gates: " + result.stdout);
  }
  console.log(JSON.stringify({ ok: true, production_submission_probe_canary: report }, null, 2));
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => server.once("exit", resolve)).catch(() => {});
  await new Promise(resolve => jwksServer.close(resolve)).catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
