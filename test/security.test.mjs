import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyCommand, containsCredentialLikeSecret, gitCommandFor, getSystemdCapabilities, publicPathLooksSensitive, redactSecrets, resolveAllowedPath, runSafeProgram, systemdCommandFor, isMainEntry } from "../server.mjs";

test("classifies read-only commands", () => {
  assert.equal(classifyCommand("systemctl status nginx"), "read_only");
  assert.equal(classifyCommand("git status"), "read_only");
  assert.equal(classifyCommand("uptime"), "read_only");
});

test("classifies mutation and destructive commands", () => {
  assert.equal(classifyCommand("touch hello.txt"), "mutation");
  assert.equal(classifyCommand("rm -rf /tmp/demo"), "destructive");
  assert.equal(classifyCommand("systemctl stop nginx"), "destructive");
  assert.equal(classifyCommand("git reset --hard HEAD~1"), "destructive");
});

test("redacts common secrets", () => {
  const value = redactSecrets("token=abc123 Authorization: Bearer eyJ.secret password=hunter2");
  assert.match(value, /token=\[REDACTED\]/);
  assert.match(value, /Bearer \[REDACTED\]/);
  assert.match(value, /password=\[REDACTED\]/);
  assert.doesNotMatch(value, /abc123|hunter2|eyJ\.secret/);
});

test("redacts high-confidence raw credential formats without labels", () => {
  const samples = [
    ["sk-", "proj-", "abcdefghijklmnopqrstuvwxyz0123456789"].join(""),
    ["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join(""),
    ["github_pat_", "abcdefghijklmnopqrstuvwxyz0123456789"].join(""),
    ["AKIA", "1234567890ABCDEF"].join(""),
    ["AIza", "SyA1234567890abcdefghijklmnopqrstuvwxyz"].join(""),
    ["xox", "b-", "1234567890-abcdefghijklmnop"].join(""),
    ["eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiJkZW1vIn0", ".", "signaturevalue"].join(""),
    ["https://operator:", "supersecret", "@example.invalid/path"].join(""),
  ];

  for (const sample of samples) {
    assert.equal(containsCredentialLikeSecret(sample), true, sample);
    assert.notEqual(redactSecrets(sample), sample, sample);
  }
});

test("does not flag ordinary identifiers as raw credentials", () => {
  const samples = [
    "sk-short",
    "github_pattern_matching_notes",
    "AKIA is a documentation prefix",
    "https://example.invalid/path",
    "release-tokenizer-design",
    "eyJ-not-a-jwt",
  ];

  for (const sample of samples) {
    assert.equal(containsCredentialLikeSecret(sample), false, sample);
  }
});

test("public file policy rejects credential-like paths and contents", () => {
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/.env"), true);
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/.ssh/id_ed25519"), true);
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/client.pem"), true);
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/id_ed25519"), true);
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/id_rsa"), true);
  assert.equal(publicPathLooksSensitive("/srv/zssh-review/notes.txt"), false);
  assert.equal(containsCredentialLikeSecret("api_key=abc123"), true);
  assert.equal(containsCredentialLikeSecret("Authorization: Bearer eyJ.demo"), true);
  assert.equal(containsCredentialLikeSecret("ordinary deployment notes"), false);
});

test("allowed path gate accepts inside root and rejects outside root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-test-"));
  const file = path.join(root, "ok.txt");
  await writeFile(file, "ok");
  const previous = process.env.ZSSH_ALLOWED_ROOTS;
  process.env.ZSSH_ALLOWED_ROOTS = root;
  try {
    assert.equal(await resolveAllowedPath(file), file);
    await assert.rejects(() => resolveAllowedPath("/etc/hosts"), /outside allowed roots/);
  } finally {
    if (previous === undefined) delete process.env.ZSSH_ALLOWED_ROOTS;
    else process.env.ZSSH_ALLOWED_ROOTS = previous;
    await rm(root, { recursive: true, force: true });
  }
});


test("safe runner blocks programs outside the hard allowlist", async () => {
  const result = await runSafeProgram("sh", ["-c", "echo nope"], process.cwd(), 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.match(result.error, /allowlist/);
});

test("safe runner executes an allowlisted program without a shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-run-test-"));
  const previous = process.env.ZSSH_ALLOWED_ROOTS;
  process.env.ZSSH_ALLOWED_ROOTS = root;
  try {
    const result = await runSafeProgram("whoami", [], root, 5);
    assert.equal(result.ok, true);
    assert.equal(result.program, "whoami");
    assert.ok(result.stdout.trim().length > 0);
    assert.equal(result.timed_out, false);
    assert.equal(result.output_limited, false);
  } finally {
    if (previous === undefined) delete process.env.ZSSH_ALLOWED_ROOTS;
    else process.env.ZSSH_ALLOWED_ROOTS = previous;
    await rm(root, { recursive: true, force: true });
  }
});


test("main-entry detection follows symlinks used by atomic live releases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-entry-test-"));
  const link = path.join(root, "server-current.mjs");
  const realServer = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "server.mjs");
  try {
    await symlink(realServer, link);
    assert.equal(isMainEntry(link), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("safe runner defaults cwd to the first configured allowed root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-default-cwd-"));
  const previousRoots = process.env.ZSSH_ALLOWED_ROOTS;
  process.env.ZSSH_ALLOWED_ROOTS = root;
  try {
    const result = await runSafeProgram("pwd", [], undefined, 5);
    assert.equal(result.ok, true);
    assert.equal(result.stdout.trim(), root);
  } finally {
    if (previousRoots === undefined) delete process.env.ZSSH_ALLOWED_ROOTS;
    else process.env.ZSSH_ALLOWED_ROOTS = previousRoots;
    await rm(root, { recursive: true, force: true });
  }
});


test("bounded Git operations use fixed argv and stay inside allowed roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-git-op-"));
  const previousRoots = process.env.ZSSH_ALLOWED_ROOTS;
  process.env.ZSSH_ALLOWED_ROOTS = root;
  try {
    const status = await gitCommandFor(root, "status");
    assert.equal(status.executable, "/usr/bin/git");
    assert.deepEqual(status.args, ["-C", root, "status", "--short", "--branch"]);

    const pull = await gitCommandFor(root, "pull");
    assert.deepEqual(pull.args, ["-C", root, "pull", "--ff-only"]);
    await assert.rejects(() => gitCommandFor("/etc", "status"), /outside allowed roots/);
    await assert.rejects(() => gitCommandFor(root, "reset"), /unsupported git action/);
  } finally {
    if (previousRoots === undefined) delete process.env.ZSSH_ALLOWED_ROOTS;
    else process.env.ZSSH_ALLOWED_ROOTS = previousRoots;
    await rm(root, { recursive: true, force: true });
  }
});

test("systemd capabilities are exact, restart-implies-inspect, and shell-free", () => {
  const previousInspect = process.env.ZSSH_SYSTEMD_INSPECT_SERVICES;
  const previousRestart = process.env.ZSSH_SYSTEMD_RESTART_SERVICES;
  process.env.ZSSH_SYSTEMD_INSPECT_SERVICES = "nginx.service";
  process.env.ZSSH_SYSTEMD_RESTART_SERVICES = "my-app.service";
  try {
    assert.deepEqual(getSystemdCapabilities(), {
      inspect: ["my-app.service", "nginx.service"],
      restart: ["my-app.service"],
    });
    assert.deepEqual(systemdCommandFor("nginx.service", "status"), {
      executable: "/usr/bin/sudo",
      args: ["-n", "/usr/bin/systemctl", "status", "nginx.service", "--no-pager"],
    });
    assert.deepEqual(systemdCommandFor("my-app.service", "restart"), {
      executable: "/usr/bin/sudo",
      args: ["-n", "/usr/bin/systemctl", "restart", "my-app.service"],
    });
    assert.throws(() => systemdCommandFor("nginx.service", "restart"), /not allowed for restart/);
    assert.throws(() => systemdCommandFor("*.service", "status"), /exact \.service/);
    assert.throws(() => systemdCommandFor("nginx.service;sh", "status"), /exact \.service/);
  } finally {
    if (previousInspect === undefined) delete process.env.ZSSH_SYSTEMD_INSPECT_SERVICES;
    else process.env.ZSSH_SYSTEMD_INSPECT_SERVICES = previousInspect;
    if (previousRestart === undefined) delete process.env.ZSSH_SYSTEMD_RESTART_SERVICES;
    else process.env.ZSSH_SYSTEMD_RESTART_SERVICES = previousRestart;
  }
});
