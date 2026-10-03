import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentRequestVerifier } from "../agent-transport.mjs";
import { createAgentClient } from "../agent.mjs";

test("target client signs every outbound agent request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-client-"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyFile = path.join(root, "agent.pem");
  await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

  const targetId = "zt_clientsign123";
  const verifier = new AgentRequestVerifier({ keys: new Map([[targetId, publicKey]]) });
  const seen = [];

  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    verifier.verify({
      method: options.method,
      pathname,
      headers: options.headers,
      body: options.body,
      now: Date.now(),
    });
    seen.push(pathname);
    if (pathname === "/agent/v1/session") {
      return new Response(JSON.stringify({ target_id: targetId, session_id: "sess_abcdefghijklmnop" }), { status: 200 });
    }
    if (pathname === "/agent/v1/poll") {
      return new Response(JSON.stringify({ command: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  };

  try {
    const client = await createAgentClient({
      env: {
        NODE_ENV: "test",
        ZSSH_GATEWAY_URL: "http://127.0.0.1:8788",
        ZSSH_TARGET_ID: targetId,
        ZSSH_AGENT_PRIVATE_KEY_FILE: keyFile,
      },
      fetchImpl,
    });
    const opened = await client.open();
    await client.poll(opened.session_id);
    await client.result(opened.session_id, "req_abcdefghijklmnop", { ok: true });
    await client.disconnect(opened.session_id);
    assert.deepEqual(seen, [
      "/agent/v1/session",
      "/agent/v1/poll",
      "/agent/v1/result",
      "/agent/v1/disconnect",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
