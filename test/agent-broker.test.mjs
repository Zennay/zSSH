import test from "node:test";
import assert from "node:assert/strict";
import { AgentRequestBroker } from "../agent-broker.mjs";

test("broker keeps target queues isolated and blocks cross-target completion", async () => {
  const broker = new AgentRequestBroker();
  const queued = broker.request("zt_alpha1234", "get_system_uptime", { marker: "private-alpha" });

  assert.equal(broker.takeNext("zt_beta12345"), null);
  const work = broker.takeNext("zt_alpha1234");
  assert.equal(work?.target_id, "zt_alpha1234");
  assert.equal(work?.tool, "get_system_uptime");
  assert.deepEqual(work?.args, { marker: "private-alpha" });

  assert.equal(broker.complete("zt_beta12345", queued.request_id, { ok: true }), false);
  assert.equal(broker.complete("zt_alpha1234", queued.request_id, { ok: true, uptime: 42 }), true);
  assert.deepEqual(await queued.result, { ok: true, uptime: 42 });
});

test("broker snapshot never exposes request arguments or result payloads", async () => {
  const broker = new AgentRequestBroker();
  const queued = broker.request("zt_snapshot12", "zssh_read_file", { secret_marker: "do-not-leak" });
  const snapshot = JSON.stringify(broker.snapshot());
  assert.match(snapshot, /zt_snapshot12/);
  assert.doesNotMatch(snapshot, /do-not-leak|zssh_read_file|secret_marker/);

  const work = broker.takeNext("zt_snapshot12");
  assert.ok(work);
  broker.complete("zt_snapshot12", queued.request_id, { content: "result-secret" });
  await queued.result;
});

test("disconnect rejects all pending work only for that target", async () => {
  const broker = new AgentRequestBroker();
  const a = broker.request("zt_disconnectA", "get_system_uptime", {});
  const b = broker.request("zt_disconnectB", "get_system_uptime", {});
  const aRejected = assert.rejects(a.result, /disconnected/);

  assert.equal(broker.disconnectTarget("zt_disconnectA"), 1);
  await aRejected;

  const bWork = broker.takeNext("zt_disconnectB");
  assert.equal(bWork?.request_id, b.request_id);
  broker.complete("zt_disconnectB", b.request_id, { ok: true });
  assert.deepEqual(await b.result, { ok: true });
});

test("broker enforces per-target/global limits and payload bounds", async () => {
  const perTarget = new AgentRequestBroker({ maxPendingPerTarget: 1, maxPendingTotal: 3 });
  const first = perTarget.request("zt_limits1234", "get_system_uptime", {});
  assert.throws(
    () => perTarget.request("zt_limits1234", "get_memory_usage", {}),
    /target pending limit/,
  );
  perTarget.complete("zt_limits1234", first.request_id, { ok: true });
  await first.result;

  const small = new AgentRequestBroker({ maxArgsBytes: 20 });
  assert.throws(
    () => small.request("zt_payload123", "zssh_read_file", { content: "x".repeat(50) }),
    /maximum bytes/,
  );
});

test("broker times out requests and removes them from pending state", async () => {
  const broker = new AgentRequestBroker({ defaultTimeoutMs: 50 });
  const queued = broker.request("zt_timeout123", "get_system_uptime", {});
  await assert.rejects(queued.result, /timed out/);
  assert.deepEqual(broker.snapshot(), { pending_total: 0, pending_by_target: {} });
});

test("broker rejects local routing and unsafe tool names", () => {
  const broker = new AgentRequestBroker();
  assert.throws(() => broker.request("local", "get_system_uptime", {}), /explicit opaque/);
  assert.throws(() => broker.request("zt_valid123", "tool;rm", {}), /tool name/);
});
