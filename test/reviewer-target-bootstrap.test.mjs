import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentPublicKeysFromEnv } from "../agent-transport.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");

async function runBootstrap(home, extraEnv = {}) {
  const reviewRoot = path.join(home, "review");
  const { stdout, stderr } = await execFileAsync(
    "bash",
    ["deploy/prepare-reviewer-target.sh", ROOT],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home,
        ZSSH_REVIEW_ROOT: reviewRoot,
        ...extraEnv,
      },
    },
  );
  return { report: JSON.parse(stdout), stderr, reviewRoot };
}

test("reviewer target bootstrap is idempotent and never prints private key material", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "zssh-review-bootstrap-"));

  try {
    const first = await runBootstrap(home);
    assert.equal(first.stderr, "");
    assert.equal(first.report.ok, true);
    assert.match(first.report.target_id, /^zt_[A-Za-z0-9_-]{8,96}$/);
    assert.match(first.report.public_key_sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.report.private_key_printed, false);
    assert.doesNotMatch(JSON.stringify(first.report), /BEGIN PRIVATE KEY/);
    assert.equal(first.report.review_file, path.join(first.reviewRoot, "sample.txt"));
    assert.equal(first.report.review_write_file, path.join(first.reviewRoot, "output.txt"));
    assert.equal(first.report.release_guard_enforced, false);
    assert.equal(first.report.release_compatible, false);
    assert.equal(first.report.release_variables, null);
    assert.match(first.report.release_blocker, /do not copy dev\/test paths into openai-production/);

    const keyFile = path.join(home, ".config", "zssh", "agent-ed25519.pem");
    const publicFile = path.join(home, ".config", "zssh", "reviewer-agent-public.json");
    const privatePem = await readFile(keyFile, "utf8");
    assert.match(privatePem, /BEGIN PRIVATE KEY/);
    assert.equal((await stat(path.dirname(keyFile))).mode & 0o777, 0o700);
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
    assert.equal((await stat(publicFile)).mode & 0o777, 0o600);
    const publicConfig = JSON.parse(await readFile(publicFile, "utf8"));
    assert.equal(publicConfig.version, 1);
    assert.deepEqual(Object.keys(publicConfig.targets), [first.report.target_id]);
    assert.equal(agentPublicKeysFromEnv({ ZSSH_AGENT_PUBLIC_KEYS_FILE: publicFile }).size, 1);
    assert.equal((await stat(first.reviewRoot)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(first.reviewRoot, "sample.txt"))).mode & 0o777, 0o600);

    // Migrate the wrapper shape shipped by PR #56 without rotating identity.
    await writeFile(publicFile, JSON.stringify({
      target_id: first.report.target_id,
      gateway_public_key_config: publicConfig,
    }, null, 2) + "\n", { mode: 0o600 });

    const second = await runBootstrap(home);
    assert.equal(second.report.target_id, first.report.target_id);
    assert.equal(second.report.public_key_sha256, first.report.public_key_sha256);
    assert.doesNotMatch(JSON.stringify(second.report), /BEGIN PRIVATE KEY/);

    const migrated = JSON.parse(await readFile(publicFile, "utf8"));
    assert.equal(migrated.version, 1);
    assert.equal(migrated.gateway_public_key_config, undefined);
    assert.deepEqual(Object.keys(migrated.targets), [first.report.target_id]);
    assert.equal(agentPublicKeysFromEnv({ ZSSH_AGENT_PUBLIC_KEYS_FILE: publicFile }).size, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reviewer target bootstrap release guard rejects non-canonical dev fixture", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "zssh-review-bootstrap-release-guard-"));

  try {
    await assert.rejects(
      () => runBootstrap(home, { ZSSH_REVIEW_REQUIRE_RELEASE_COMPATIBLE: "1" }),
      /reviewer fixture is not at the canonical submitted paths/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});


test("reviewer target bootstrap fails closed on partial identity state", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "zssh-review-bootstrap-partial-"));
  const config = path.join(home, ".config", "zssh");
  const publicFile = path.join(config, "reviewer-agent-public.json");

  try {
    await writeFile(publicFile, "{}\n", { mode: 0o600 }).catch(async error => {
      if (error?.code !== "ENOENT") throw error;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(config, { recursive: true, mode: 0o700 });
      await writeFile(publicFile, "{}\n", { mode: 0o600 });
    });

    await assert.rejects(
      () => runBootstrap(home),
      /both private key and public config must exist/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});


test("README does not present the default reviewer fixture as production-compatible", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /default .*development\/test fixture/i);
  assert.match(readme, /release_compatible=false/);
  assert.match(readme, /release_variables=null/);
  assert.match(
    readme,
    /ZSSH_REVIEW_ROOT=\/srv\/zssh-review ZSSH_REVIEW_REQUIRE_RELEASE_COMPATIBLE=1 npm run review:target/,
  );
  assert.match(readme, /fails closed instead of returning a development-only fixture/);
  assert.match(readme, /Only the exact submitted files `\/srv\/zssh-review\/sample\.txt` and `\/srv\/zssh-review\/output\.txt` produce `release_compatible=true`/);
  assert.doesNotMatch(
    readme,
    /prints a secret-safe JSON report with `ZSSH_REVIEW_FILE`, `ZSSH_REVIEW_WRITE_FILE`/,
  );
});
