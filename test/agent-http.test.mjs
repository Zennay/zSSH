import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createAgentHttpHandler } from "../agent-http.mjs";
import {
  AgentReplayCache,
  OutboundAgentBroker,
  canonicalAgentRequest,
} from "../agent-transport.mjs";
import { TargetSessionRegistry } from "../target-routing.mjs";

const FIXED_NOW = Date.parse("2026-10-03T23:45:00Z");
const FIXED_TS = Math.floor(FIXED_NOW / 1000);

function signedHeaders(privateKey, {
  path,
  targetId = "zt_http12345",
  nonce,
  body,
  timestamp = FIXED_TS,
} = {}) {
  const canonical = canonicalAgentRequest({
    method: "POST",
    requestPath: path,
    targetId,
    timestamp,
    nonce,
    body,
  });
  return {
    "content-type": "application/json",
    "x-zssh-target-id": targetId,
    "x-zssh-agent-timestamp": String(timestamp),
    "x-zssh-agent-nonce": nonce,
    "x-zssh-agent-signature": crypto
      .sign(null, Buffer.from(canonical, "utf8"), privateKey)
      .toString("base64url"),
  };
}

async function startFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    commandTimeoutMs: 4000,
  });
  const handler = createAgentHttpHandler({
    trustedKeys: new Map([["zt_http12345", publicKey]]),
    replayCache: new AgentReplayCache(),
    broker,
    now: () => FIXED_NOW,
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const handled = await handler(req, res, url);
    if (!handled) res.writeHead(404).end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  return {
    privateKey,
    sessions,
    broker,
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function signedPost(fixture, path, bodyValue, nonce, overrides = {}) {
  const body = JSON.stringify(bodyValue);
  return fetch(fixture.base + path, {
    method: "POST",
    headers: signedHeaders(fixture.privateKey, {
      path,
      nonce,
      body,
      ...overrides,
    }),
    body,
  });
}

test("signed agent HTTP flow bridges broker request and target result", async () => {
  const fixture = await startFixture();
  try {
    const sessionId = "sess_httpflow123456";
    const connect = await signedPost(
      fixture,
      "/agent/v1/connect",
      { session_id: sessionId },
      "nonce_connect123456789",
    );
    assert.equal(connect.status, 200);
    assert.deepEqual(await connect.json(), {
      ok: true,
      target_id: "zt_http12345",
      session_id: sessionId,
      connected_at: new Date(FIXED_NOW).toISOString(),
    });

    const route = fixture.sessions.resolve("zt_http12345");
    assert.ok(route);
    const responsePromise = route.send({
      tool: "get_system_uptime",
      args: {},
    });

    const poll = await signedPost(
      fixture,
      "/agent/v1/poll",
      { session_id: sessionId, wait_ms: 0 },
      "nonce_poll123456789012",
    );
    assert.equal(poll.status, 200);
    const command = await poll.json();
    assert.equal(command.type, "tool_call");
    assert.equal(command.tool, "get_system_uptime");
    assert.match(command.request_id, /^rpc_/);

    const result = await signedPost(
      fixture,
      "/agent/v1/result",
      {
        session_id: sessionId,
        request_id: command.request_id,
        result: { ok: true, stdout: "up 3 days" },
      },
      "nonce_result1234567890",
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).accepted, true);
    assert.deepEqual(await responsePromise, {
      ok: true,
      stdout: "up 3 days",
    });

    const disconnect = await signedPost(
      fixture,
      "/agent/v1/disconnect",
      { session_id: sessionId },
      "nonce_disconnect123456",
    );
    assert.equal(disconnect.status, 200);
    assert.equal(fixture.sessions.resolve("zt_http12345"), null);
  } finally {
    await fixture.close();
  }
});

test("signed agent HTTP endpoint rejects replay and body tampering", async () => {
  const fixture = await startFixture();
  try {
    const path = "/agent/v1/connect";
    const nonce = "nonce_replay1234567890";
    const original = { session_id: "sess_replay12345678" };
    const first = await signedPost(fixture, path, original, nonce);
    assert.equal(first.status, 200);

    const replay = await signedPost(fixture, path, original, nonce);
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), { error: "agent_authentication_failed" });

    const body = JSON.stringify({ session_id: "sess_tampered123456" });
    const signedBody = JSON.stringify({ session_id: "sess_signed12345678" });
    const tampered = await fetch(fixture.base + path, {
      method: "POST",
      headers: signedHeaders(fixture.privateKey, {
        path,
        nonce: "nonce_tampered12345678",
        body: signedBody,
      }),
      body,
    });
    assert.equal(tampered.status, 401);
  } finally {
    await fixture.close();
  }
});

test("stale agent sessions fail closed at HTTP boundary", async () => {
  const fixture = await startFixture();
  try {
    const firstSession = "sess_firsthttp123456";
    const secondSession = "sess_secondhttp12345";

    assert.equal((await signedPost(
      fixture,
      "/agent/v1/connect",
      { session_id: firstSession },
      "nonce_firstconnect123456",
    )).status, 200);

    assert.equal((await signedPost(
      fixture,
      "/agent/v1/connect",
      { session_id: secondSession },
      "nonce_secondconnect12345",
    )).status, 200);

    const stalePoll = await signedPost(
      fixture,
      "/agent/v1/poll",
      { session_id: firstSession, wait_ms: 0 },
      "nonce_stalepoll1234567",
    );
    assert.equal(stalePoll.status, 409);
    assert.deepEqual(await stalePoll.json(), { error: "agent_session_conflict" });

    const currentPoll = await signedPost(
      fixture,
      "/agent/v1/poll",
      { session_id: secondSession, wait_ms: 0 },
      "nonce_currentpoll12345",
    );
    assert.equal(currentPoll.status, 200);
    assert.deepEqual(await currentPoll.json(), { type: "idle" });
  } finally {
    await fixture.close();
  }
});

test("agent HTTP namespace is POST JSON only and does not enable CORS", async () => {
  const fixture = await startFixture();
  try {
    const method = await fetch(fixture.base + "/agent/v1/connect");
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("access-control-allow-origin"), null);

    const unsupported = await fetch(fixture.base + "/agent/v1/unknown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unsupported.status, 404);

    const unsigned = await fetch(fixture.base + "/agent/v1/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "sess_unsigned123456" }),
    });
    assert.equal(unsigned.status, 401);
  } finally {
    await fixture.close();
  }
});
