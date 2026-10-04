import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentPublicKeysFromEnv } from "../agent-transport.mjs";

const execFileAsync = promisify(execFile);

test("target-local identity provisioning never prints or overwrites private key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-identity-"));
  const keyFile = path.join(root, "config", "agent-ed25519.pem");
  const publicConfigFile = path.join(root, "public-keys.json");
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
    assert.match(report.gateway_public_key_config.targets[targetId].public_key_pem, /BEGIN PUBLIC KEY/);
    assert.doesNotMatch(stdout, /BEGIN PRIVATE KEY/);

    const privatePem = await readFile(keyFile, "utf8");
    assert.match(privatePem, /BEGIN PRIVATE KEY/);
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(keyFile))).mode & 0o777, 0o700);

    await writeFile(publicConfigFile, JSON.stringify(report.gateway_public_key_config), "utf8");
    const trusted = agentPublicKeysFromEnv({ ZSSH_AGENT_PUBLIC_KEYS_FILE: publicConfigFile });
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
