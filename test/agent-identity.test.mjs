import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadAgentPrivateKey } from "../target-agent-client.mjs";
import { loadAgentTrustFileSync } from "../agent-transport.mjs";

const execFileAsync = promisify(execFile);

test("agent identity provisioning keeps private key local and emits only public trust record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-identity-"));
  const keyFile = path.join(root, "config", "agent.pem");
  const trustFile = path.join(root, "trust.json");
  const targetId = "zt_identity1234";

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/create-agent-identity.mjs", targetId, keyFile],
      { cwd: path.resolve(".") },
    );
    assert.equal(stderr, "");

    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.target_id, targetId);
    assert.equal(report.private_key_printed, false);
    assert.equal(report.private_key_file, keyFile);
    assert.match(report.gateway_trust_record.targets[targetId].public_key_pem, /BEGIN PUBLIC KEY/);
    assert.doesNotMatch(stdout, /BEGIN PRIVATE KEY/);

    const privatePem = await readFile(keyFile, "utf8");
    assert.match(privatePem, /BEGIN PRIVATE KEY/);
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(keyFile))).mode & 0o777, 0o700);
    assert.equal((await loadAgentPrivateKey(keyFile)).asymmetricKeyType, "ed25519");

    await writeFile(trustFile, JSON.stringify(report.gateway_trust_record), "utf8");
    const trusted = loadAgentTrustFileSync(trustFile);
    assert.equal(trusted.size, 1);
    assert.equal(trusted.get(targetId)?.asymmetricKeyType, "ed25519");

    await assert.rejects(
      () => execFileAsync(
        process.execPath,
        ["scripts/create-agent-identity.mjs", targetId, keyFile],
        { cwd: path.resolve(".") },
      ),
      /already exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
