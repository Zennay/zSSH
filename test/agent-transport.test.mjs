import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentReplayCache,
  OutboundAgentBroker,
  canonicalAgentRequest,
  verifySignedAgentRequest,
} from "../agent-transport.mjs";
import {
  approvePairing,
  getPairingStatus,
  revokePairing,
} from "../pairing.mjs";
import {
  TargetSessionRegistry,
  resolveAuthenticatedTarget,
} from "../target-routing.mjs";

function auth(subject = "agent-user") {
  return {
    clientId: subject,
    scopes: ["zssh:read", "zssh:write"],
    extra: {
      sub: subject,
      issuer: "https://auth.example",
    },
  };
}

function signedRequest({
  privateKey,
  targetId = "zt_agent12345",
  timestamp = 1791068400,
  nonce = "nonce_abcdefghijklmnop",
  body = '{"kind":"poll"}',
} = {}) {
  const canonical = canonicalAgentRequest({
    method: "POST",
    requestPath: "/agent/v1/poll",
    targetId,
    timestamp,
    nonce,
    body,
  });
  return {
    method: "POST",
    requestPath: "/agent/v1/poll",
    targetId,
    timestamp,
    nonce,
    body,
    signature: crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url"),
  };
}

test("signed agent requests authenticate with Ed25519 and reject replay", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const trustedKeys = new Map([["zt_agent12345", publicKey]]);
  const replayCache = new AgentReplayCache();
  const request = signedRequest({ privateKey });

  const verified = verifySignedAgentRequest({
    ...request,
    trustedKeys,
    replayCache,
    now: request.timestamp * 1000,
  });
  assert.deepEqual(verified, {
    target_id: "zt_agent12345",
    authenticated: true,
  });

  assert.throws(
    () => verifySignedAgentRequest({
      ...request,
      trustedKeys,
      replayCache,
      now: request.timestamp * 1000,
    }),
    /replay detected/,
  );
});

test("agent auth fails closed for untrusted target, bad signature and stale timestamp", () => {
  const first = crypto.generateKeyPairSync("ed25519");
  const second = crypto.generateKeyPairSync("ed25519");
  const trustedKeys = new Map([["zt_agent12345", first.publicKey]]);

  assert.throws(
    () => verifySignedAgentRequest({
      ...signedRequest({ privateKey: first.privateKey, targetId: "zt_other12345" }),
      trustedKeys,
      replayCache: new AgentReplayCache(),
      now: 1791068400 * 1000,
    }),
    /not trusted/,
  );

  assert.throws(
    () => verifySignedAgentRequest({
      ...signedRequest({ privateKey: second.privateKey }),
      trustedKeys,
      replayCache: new AgentReplayCache(),
      now: 1791068400 * 1000,
    }),
    /signature verification failed/,
  );

  const stale = signedRequest({
    privateKey: first.privateKey,
    timestamp: 1791068000,
    nonce: "nonce_staleabcdefghijk",
  });
  assert.throws(
    () => verifySignedAgentRequest({
      ...stale,
      trustedKeys,
      replayCache: new AgentReplayCache(),
      now: 1791068400 * 1000,
    }),
    /outside allowed clock skew/,
  );
});

test("outbound broker forwards only bounded allowlisted target tools", async () => {
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    commandTimeoutMs: 2000,
  });
  const sessionId = "sess_abcdefghijklmnop";
  broker.connect("zt_agent12345", { sessionId });

  const live = sessions.resolve("zt_agent12345");
  assert.ok(live);

  const responsePromise = live.send({
    tool: "get_system_uptime",
    args: {},
  });
  const command = await broker.pull("zt_agent12345", sessionId, { waitMs: 0 });

  assert.equal(command.type, "tool_call");
  assert.equal(command.tool, "get_system_uptime");
  assert.deepEqual(command.args, {});
  assert.match(command.request_id, /^rpc_/);

  broker.complete("zt_agent12345", sessionId, {
    request_id: command.request_id,
    result: { ok: true, stdout: "up 2 days" },
  });
  assert.deepEqual(await responsePromise, {
    ok: true,
    stdout: "up 2 days",
  });

  await assert.rejects(
    live.send({ tool: "zssh_exec", args: { command: "id" } }),
    /not allowed/,
  );

  assert.deepEqual(broker.snapshot().map(({ target_id, queued_commands, pending_commands }) => ({
    target_id,
    queued_commands,
    pending_commands,
  })), [{
    target_id: "zt_agent12345",
    queued_commands: 0,
    pending_commands: 0,
  }]);
});

test("new agent session replaces the old route and stale session cannot answer", async () => {
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    commandTimeoutMs: 2000,
  });

  const first = broker.connect("zt_agent12345", {
    sessionId: "sess_firstsession123",
  });
  const oldRoute = sessions.resolve("zt_agent12345");

  const pending = oldRoute.send({
    tool: "get_memory_usage",
    args: {},
  });
  const command = await broker.pull(first.target_id, first.session_id, { waitMs: 0 });

  const second = broker.connect("zt_agent12345", {
    sessionId: "sess_secondsession12",
  });

  await assert.rejects(pending, /replaced by a newer agent session/);
  assert.equal(sessions.resolve("zt_agent12345").session_id, second.session_id);
  assert.throws(
    () => broker.complete(first.target_id, first.session_id, {
      request_id: command.request_id,
      result: { ok: true },
    }),
    /not current/,
  );
});

test("paired OAuth route reaches live outbound agent and revocation cuts it off", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-bridge-"));
  const file = path.join(root, "pairings.json");
  const env = {
    ZSSH_PAIRING_FILE: file,
    ZSSH_TARGET_ID: "zt_agent12345",
  };
  const resource = "https://mcp.example";
  const identity = auth("paired-agent-user");
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    commandTimeoutMs: 2000,
  });
  const session = broker.connect("zt_agent12345", {
    sessionId: "sess_bridgeagent123",
  });

  try {
    const pairing = await getPairingStatus(identity, {
      resource,
      createRequest: true,
      env,
    });
    const approved = await approvePairing(pairing.request_id, { env });
    assert.equal(approved.target_id, "zt_agent12345");

    const routed = await resolveAuthenticatedTarget(identity, {
      resource,
      env,
      sessions,
    });
    assert.equal(routed.routable, true);

    const responsePromise = routed.send({
      tool: "get_disk_usage",
      args: {},
    });
    const command = await broker.pull(session.target_id, session.session_id, {
      waitMs: 0,
    });
    broker.complete(session.target_id, session.session_id, {
      request_id: command.request_id,
      result: { ok: true, stdout: "disk-ok" },
    });
    assert.deepEqual(await responsePromise, {
      ok: true,
      stdout: "disk-ok",
    });

    await revokePairing(approved.profile_id, {
      targetId: approved.target_id,
      env,
    });
    const blocked = await resolveAuthenticatedTarget(identity, {
      resource,
      env,
      sessions,
    });
    assert.equal(blocked.routable, false);
    assert.equal(blocked.reason, "not_paired");
  } finally {
    broker.disconnect(session.target_id, session.session_id);
    await rm(root, { recursive: true, force: true });
  }
});
