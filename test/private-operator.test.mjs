import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const program = fileURLToPath(new URL("../ops/enable-private-operator.mjs", import.meta.url));
const baseConfig = [
  "NODE_ENV=production",
  "ZSSH_DEV_BEARER_TOKEN=" + "a".repeat(64),
  "ZSSH_EXEC_MODE=disabled",
  "ZSSH_ALLOWED_ROOTS=/home/zssh/workspace",
  "ZSSH_MAX_FILE_BYTES=131072",
  ""
].join("\n");

function withConfig(content, fn, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zssh-max-access-"));
  const file = path.join(root, "gateway.env");
  fs.writeFileSync(file, content, { mode: opts.mode ?? 0o600 });
  const run = (...args) => spawnSync(process.execPath, [program, ...args], {
    encoding: "utf8", env: { ...process.env, ZSSH_ENV_FILE: file }
  });
  try { return fn({ file, run, root }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("maximum private operator mode reports dry-run without touching the config", () => {
  withConfig(baseConfig, ({ file, run }) => {
    const before = fs.readFileSync(file, "utf8");
    const res = run("--check");
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /CHECK_OK/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.doesNotMatch(res.stdout, /a{32}/);
  });
});

test("maximum private operator mode requires explicit risk acceptance", () => {
  withConfig(baseConfig, ({ file, run }) => {
    const res = run("--apply");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--accept-risk/);
    assert.equal(fs.readFileSync(file, "utf8"), baseConfig);
  });
});

test("maximum private operator mode applies highest bounded limits and stays private", () => {
  withConfig(baseConfig, ({ file, run }) => {
    const first = run("--apply", "--accept-risk");
    assert.equal(first.status, 0, first.stderr);
    const content = fs.readFileSync(file, "utf8");
    for (const expected of [
      "ZSSH_PLUGIN_PROFILE=private",
      "ZSSH_ALLOWED_ROOTS=/",
      "ZSSH_EXEC_MODE=full",
      "ZSSH_MAX_FILE_BYTES=1048576",
      "ZSSH_MAX_OUTPUT_BYTES=1048576",
      "ZSSH_COMMAND_TIMEOUT_SECONDS=300"
    ]) assert.ok(content.includes(expected + "\n"), expected);
    assert.ok(content.includes("ZSSH_DEV_BEARER_TOKEN=" + "a".repeat(64)));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const second = run("--apply", "--accept-risk");
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  });
});

test("maximum private operator mode never converts a public profile", () => {
  withConfig(baseConfig + "ZSSH_PLUGIN_PROFILE=public\n", ({ run, file }) => {
    assert.equal(run("--apply", "--accept-risk").status, 2);
    assert.match(fs.readFileSync(file, "utf8"), /ZSSH_PLUGIN_PROFILE=public/);
  });
});

test("maximum private operator mode refuses world-readable credentials", () => {
  withConfig(baseConfig, ({ run }) => {
    assert.equal(run("--check").status, 2);
  }, { mode: 0o644 });
});

test("maximum private operator mode refuses missing auth and duplicate policy keys", () => {
  withConfig("ZSSH_EXEC_MODE=disabled\n", ({ run }) => {
    assert.equal(run("--check").status, 2);
  });
  withConfig(baseConfig + "ZSSH_EXEC_MODE=full\n", ({ run }) => {
    assert.equal(run("--check").status, 2);
  });
});

test("maximum private operator mode refuses symlinked gateway configuration", () => {
  withConfig(baseConfig, ({ file, run, root }) => {
    const moved = path.join(root, "gateway.real.env");
    fs.renameSync(file, moved);
    fs.symlinkSync(moved, file);
    assert.equal(run("--check").status, 2);
  });
});
