import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentHttpHandler } from "../agent-http.mjs";
import {
  AgentReplayCache,
  OutboundAgentBroker,
} from "../agent-transport.mjs";
import { TargetSessionRegistry } from "../target-routing.mjs";
import {
  TargetAgentHttpClient,
  loadAgentPrivateKey,
} from "../target-agent-client.mjs";

const FIXED_NOW = Date.parse("2026-10-03T23:50:00Z");

async function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({ sessions, commandTimeoutMs: 3000 });
  const handler = createAgentHttpHandler({
    trustedKeys: new Map([["zt_client1234", publicKey]]),
    replayCache: new AgentReplayCache(),
    broker,
    now: () => FIXED_NOW,
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!(await handler(req, res, url))) res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    privateKey,
    sessions,
    broker,
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

test("target agent client signs connect, poll, result and disconnect end to end", async () => {
  const f = await fixture();
  try {
    const client = new TargetAgentHttpClient({
      gatewayUrl: f.base,
      targetId: "zt_client1234",
      privateKey: f.privateKey,
      sessionId: "sess_clientflow12345",
      allowHttpLoopback: true,
      now: () => FIXED_NOW,
    });

    const connected = await client.connect();
    assert.equal(connected.ok, true);
    assert.equal(f.sessions.resolve("zt_client1234")?.session_id, client.sessionId);

    const route = f.sessions.resolve("zt_client1234");
    const resultPromise = route.send({ tool: "get_memory_usage", args: {} });
    const command = await client.poll(0);
    assert.equal(command.tool, "get_memory_usage");

    await client.complete(command.request_id, { ok: true, stdout: "memory-ok" });
    assert.deepEqual(await resultPromise, { ok: true, stdout: "memory-ok" });

    await client.disconnect();
    assert.equal(f.sessions.resolve("zt_client1234"), null);
  } finally {
    await f.close();
  }
});

test("target agent client requires HTTPS except explicit loopback test mode", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  assert.throws(
    () => new TargetAgentHttpClient({
      gatewayUrl: "http://gateway.example.invalid",
      targetId: "zt_client1234",
      privateKey,
    }),
    /must use HTTPS/,
  );
  assert.doesNotThrow(
    () => new TargetAgentHttpClient({
      gatewayUrl: "http://127.0.0.1:8788",
      targetId: "zt_client1234",
      privateKey,
      allowHttpLoopback: true,
    }),
  );
  assert.throws(
    () => new TargetAgentHttpClient({
      gatewayUrl: "https://gateway.example.invalid/agent",
      targetId: "zt_client1234",
      privateKey,
    }),
    /origin only/,
  );
});

test("target agent private key loader requires regular Ed25519 mode-0600 file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-key-"));
  const file = path.join(root, "agent-key.pem");
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });

  try {
    await writeFile(file, pem, { mode: 0o644 });
    await assert.rejects(() => loadAgentPrivateKey(file), /group\/world accessible/);

    await chmod(file, 0o600);
    const loaded = await loadAgentPrivateKey(file);
    assert.equal(loaded.asymmetricKeyType, "ed25519");
    assert.equal(loaded.type, "private");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target agent client rejects local target and private key mismatch", () => {
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(
    () => new TargetAgentHttpClient({
      gatewayUrl: "https://gateway.example.invalid",
      targetId: "zt_client1234",
      privateKey: rsa,
    }),
    /Ed25519/,
  );

  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  assert.throws(
    () => new TargetAgentHttpClient({
      gatewayUrl: "https://gateway.example.invalid",
      targetId: "local",
      privateKey,
    }),
    /explicit opaque/,
  );
});
