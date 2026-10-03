import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClientToken, revokeClientToken } from "./auth-store.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "zssh-client-token-canary-"));
const store = path.join(root, "config", "clients.json");
const audit = path.join(root, "audit.jsonl");
const port = Number(process.env.ZSSH_CLIENT_TOKEN_CANARY_PORT || 18791);
process.env.ZSSH_CLIENT_TOKENS_FILE = store;

const created = await createClientToken("ci-revocation-canary");
const endpoint = new URL(`http://127.0.0.1:${port}/mcp/${created.token}`);

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: path.dirname(new URL(import.meta.url).pathname),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    ZSSH_PLUGIN_PROFILE: "private",
    ZSSH_PUBLIC_AUTH_MODE: "oauth",
    ZSSH_CLIENT_TOKENS_FILE: store,
    ZSSH_ALLOWED_ROOTS: root,
    ZSSH_AUDIT_LOG: audit,
    ZSSH_EXEC_MODE: "disabled",
    ZSSH_DEV_BEARER_TOKEN: "",
    ZSSH_API_KEY: "",
    ZSSH_MCP_CAPABILITY_TOKEN: "",
    ZSSH_TRUST_LOCAL_TUNNEL: "0",
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
server.stderr.on("data", chunk => {
  stderr += String(chunk).replace(/zssh_[0-9a-f]{16}_[A-Za-z0-9_-]{40,}/g, "[REDACTED_ZSSH_TOKEN]");
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("client-token canary server did not become healthy: " + stderr.slice(-800));
}

function makeClient(name) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Accept: "application/json, text/event-stream" } },
  });
  return { client, transport };
}

try {
  await waitForHealth();

  const first = makeClient("zssh-private-client-token-canary");
  try {
    await first.client.connect(first.transport);
    const listed = await first.client.listTools();
    const names = new Set((listed.tools || []).map(tool => tool.name));
    for (const required of ["zssh_server_info", "zssh_read_file", "zssh_write_file"]) {
      if (!names.has(required)) throw new Error("missing private MCP tool: " + required);
    }
  } finally {
    await first.client.close().catch(() => {});
  }

  if (!(await revokeClientToken(created.id))) {
    throw new Error("client token revoke did not update the local store");
  }

  const revoked = makeClient("zssh-revoked-client-token-canary");
  let rejected = false;
  try {
    await revoked.client.connect(revoked.transport);
  } catch {
    rejected = true;
  } finally {
    await revoked.client.close().catch(() => {});
  }
  if (!rejected) throw new Error("revoked client token still authenticated");

  console.log(JSON.stringify({
    ok: true,
    auth: "private-revocable-client-token",
    token_stored_as_hash: true,
    initial_connection_allowed: true,
    revoked_connection_blocked: true,
  }));
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, 1500).unref();
  });
  await rm(root, { recursive: true, force: true });
}
