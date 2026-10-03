import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
  verifyAgentToken,
} from "../agent-auth-store.mjs";
import { redactSecrets } from "../server.mjs";

test("agent tokens are target-bound, hash-only at rest, mode 0600, and revocable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-token-"));
  const env = { ZSSH_AGENT_TOKENS_FILE: path.join(root, "config", "agents.json") };

  try {
    const created = await createAgentToken("zt_agent1234", "review-target", {
      env,
      now: Date.parse("2026-10-03T23:00:00Z"),
    });
    assert.match(created.token, /^zssh_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.target_id, "zt_agent1234");

    const raw = await readFile(env.ZSSH_AGENT_TOKENS_FILE, "utf8");
    assert.equal(raw.includes(created.token), false);
    assert.match(raw, /"target_id": "zt_agent1234"/);
    assert.match(raw, /"token_hash": "[0-9a-f]{64}"/);
    assert.equal((await stat(env.ZSSH_AGENT_TOKENS_FILE)).mode & 0o777, 0o600);

    const verified = await verifyAgentToken(created.token, { env });
    assert.deepEqual(
      { id: verified?.id, target_id: verified?.target_id, label: verified?.label },
      { id: created.id, target_id: "zt_agent1234", label: "review-target" },
    );

    const listed = await listAgentTokens({ env });
    assert.equal(listed.length, 1);
    assert.equal(JSON.stringify(listed).includes(created.token), false);

    assert.notEqual(redactSecrets(created.token), created.token);
    assert.equal(await verifyAgentToken(created.token + "x", { env }), null);
    assert.equal(await revokeAgentToken(created.id, { env }), true);
    assert.equal(await verifyAgentToken(created.token, { env }), null);
    assert.equal(await revokeAgentToken(created.id, { env }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent token creation rejects local and malformed target identities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-target-"));
  const env = { ZSSH_AGENT_TOKENS_FILE: path.join(root, "agents.json") };
  try {
    await assert.rejects(() => createAgentToken("local", "agent", { env }), /explicit opaque/);
    await assert.rejects(() => createAgentToken("https://target.example", "agent", { env }), /target id/);
    await assert.rejects(() => createAgentToken("zt_valid123", "bad;label", { env }), /agent label/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
