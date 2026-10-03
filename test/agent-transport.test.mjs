import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  AgentRequestVerifier,
  OutboundAgentBroker,
  canonicalAgentRequest,
  signAgentRequest,
} from "../agent-transport.mjs";
import { TargetSessionRegistry } from "../target-routing.mjs";

function keys(targetId = "zt_agenttest123") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    targetId,
    publicKey,
    privateKey,
    verifier: new AgentRequestVerifier({ keys: new Map([[targetId, publicKey]]) }),
  };
}

function signed({ verifier, privateKey, targetId, pathname, body, now, nonce = "n_abcdefghijklmnop" }) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = signAgentRequest(privateKey, {
    method: "POST",
    pathname,
    targetId,
    timestamp,
    nonce,
    body,
  });
  return verifier.verify({
    method: "POST",
    pathname,
    body,
    now,
    headers: {
      "x-zssh-agent-target": targetId,
      "x-zssh-agent-timestamp": timestamp,
      "x-zssh-agent-nonce": nonce,
      "x-zssh-agent-signature": signature,
    },
  });
}

test("agent request signature binds target, endpoint, timestamp, nonce and body", () => {
  const { verifier, privateKey, targetId } = keys();
  const now = Date.parse("2026-10-03T23:45:00Z");
  const body = JSON.stringify({ session_id: "sess_abcdefghijklmnop" });

  assert.deepEqual(
    signed({ verifier, privateKey, targetId, pathname: "/agent/v1/poll", body, now }),
    { target_id: targetId },
  );

  const second = keys("zt_otheragent12");
  const timestamp = String(Math.floor(now / 1000));
  const signature = signAgentRequest(second.privateKey, {
    method: "POST",
    pathname: "/agent/v1/poll",
    targetId: second.targetId,
    timestamp,
    nonce: "n_qrstuvwxyzABCDEF",
    body,
  });

  assert.throws(
    () => verifier.verify({
      method: "POST",
      pathname: "/agent/v1/poll",
      body,
      now,
      headers: {
        "x-zssh-agent-target": targetId,
        "x-zssh-agent-timestamp": timestamp,
        "x-zssh-agent-nonce": "n_qrstuvwxyzABCDEF",
        "x-zssh-agent-signature": signature,
      },
    }),
    /invalid agent request signature/,
  );
});

test("agent request verifier rejects replay and stale timestamps", () => {
  const { verifier, privateKey, targetId } = keys();
  const now = Date.parse("2026-10-03T23:45:00Z");
  const body = "{}";
  const pathname = "/agent/v1/session";
  const nonce = "n_replaynonce123456";
  const timestamp = String(Math.floor(now / 1000));
  const signature = signAgentRequest(privateKey, {
    method: "POST",
    pathname,
    targetId,
    timestamp,
    nonce,
    body,
  });
  const request = {
    method: "POST",
    pathname,
    body,
    now,
    headers: {
      "x-zssh-agent-target": targetId,
      "x-zssh-agent-timestamp": timestamp,
      "x-zssh-agent-nonce": nonce,
      "x-zssh-agent-signature": signature,
    },
  };

  verifier.verify(request);
  assert.throws(() => verifier.verify(request), /replay detected/);

  const staleTimestamp = String(Math.floor((now - 120_000) / 1000));
  const staleNonce = "n_stalenonce1234567";
  const staleSignature = signAgentRequest(privateKey, {
    method: "POST",
    pathname,
    targetId,
    timestamp: staleTimestamp,
    nonce: staleNonce,
    body,
  });
  assert.throws(
    () => verifier.verify({
      ...request,
      headers: {
        "x-zssh-agent-target": targetId,
        "x-zssh-agent-timestamp": staleTimestamp,
        "x-zssh-agent-nonce": staleNonce,
        "x-zssh-agent-signature": staleSignature,
      },
    }),
    /clock-skew window/,
  );
});

test("canonical signed message changes when the body changes", () => {
  const fields = {
    pathname: "/agent/v1/result",
    targetId: "zt_agenttest123",
    timestamp: "1791061500",
    nonce: "n_bodyhash12345678",
  };
  const a = canonicalAgentRequest({ ...fields, body: JSON.stringify({ ok: true }) });
  const b = canonicalAgentRequest({ ...fields, body: JSON.stringify({ ok: false }) });
  assert.notEqual(a, b);
});

test("broker forwards a request only through the current live agent session", async () => {
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    requestTimeoutMs: 5_000,
    pollTimeoutMs: 1_000,
  });

  const opened = broker.open("zt_forward1234");
  const route = sessions.resolve("zt_forward1234");
  assert.equal(route.session_id, opened.session_id);

  const responsePromise = route.send({
    tool: "get_system_uptime",
    args: {},
  });

  const command = await broker.next("zt_forward1234", opened.session_id);
  assert.equal(command.payload.tool, "get_system_uptime");
  assert.deepEqual(command.payload.args, {});

  assert.throws(
    () => broker.complete("zt_forward1234", opened.session_id, command.request_id, undefined),
    /result is required/,
  );

  const accepted = broker.complete(
    "zt_forward1234",
    opened.session_id,
    command.request_id,
    { ok: true, stdout: "up 1 day" },
  );
  assert.equal(accepted.accepted, true);
  assert.deepEqual(await responsePromise, { ok: true, stdout: "up 1 day" });
});

test("session replacement invalidates the old poller and rejects its pending work", async () => {
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    requestTimeoutMs: 5_000,
    pollTimeoutMs: 1_000,
  });

  const first = broker.open("zt_replace123");
  const firstRoute = sessions.resolve("zt_replace123");
  const pending = firstRoute.send({ tool: "get_kernel_info", args: {} });

  const second = broker.open("zt_replace123");
  await assert.rejects(pending, /session replaced/);
  assert.equal(sessions.resolve("zt_replace123").session_id, second.session_id);
  assert.throws(
    () => broker.complete("zt_replace123", first.session_id, "req_abcdefghijklmnop", { ok: true }),
    /not active/,
  );
});

test("broker enforces one long poll and bounded target-local session state", async () => {
  const sessions = new TargetSessionRegistry();
  const broker = new OutboundAgentBroker({
    sessions,
    requestTimeoutMs: 5_000,
    pollTimeoutMs: 1_000,
  });
  const opened = broker.open("zt_polltarget12");

  const poll = broker.next("zt_polltarget12", opened.session_id);
  await assert.rejects(
    broker.next("zt_polltarget12", opened.session_id),
    /one active long poll/,
  );
  assert.equal(await poll, null);

  const snapshot = JSON.stringify(broker.snapshot());
  assert.doesNotMatch(snapshot, /private|public_key|signature|transport/i);
  assert.match(snapshot, /zt_polltarget12/);
});
