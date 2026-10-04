import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VERIFIER = fileURLToPath(new URL("../scripts/verify-release-provenance.mjs", import.meta.url));
const HEAD = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function materializeRelease() {
  const root = mkdtempSync(path.join(tmpdir(), "zssh-release-provenance-"));
  const release = path.join(root, "release");
  const archive = path.join(root, "release.tar");
  mkdirSync(release);

  execFileSync(
    "git",
    ["-C", ROOT, "archive", "--format=tar", `--output=${archive}`, HEAD],
    { stdio: "pipe" },
  );
  execFileSync("tar", ["-xf", archive, "-C", release], { stdio: "pipe" });

  return { root, release };
}

function verify(release) {
  return execFileSync(
    process.execPath,
    [VERIFIER, ROOT, HEAD, release],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

test("verifier accepts an exact git-archive release tree", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = JSON.parse(verify(release));
  assert.equal(result.ok, true);
  assert.equal(result.sha, HEAD);
  assert.ok(result.tracked_files_verified > 0);
});

test("verifier rejects tracked content drift in an existing release directory", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  appendFileSync(path.join(release, "package.json"), "\n");
  assert.throws(
    () => verify(release),
    /tracked file content drifted: package\.json/,
  );
});

test("verifier rejects tracked regular files replaced by symlinks", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const packageJson = path.join(release, "package.json");
  unlinkSync(packageJson);
  symlinkSync("package-lock.json", packageJson);

  assert.throws(
    () => verify(release),
    /tracked regular file became a different file type: package\.json/,
  );
});

test("verifier rejects executable-bit drift", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const installer = path.join(release, "deploy", "install-live.sh");
  chmodSync(installer, 0o644);

  assert.throws(
    () => verify(release),
    /tracked executable mode drifted: deploy\/install-live\.sh/,
  );
});

test("verifier permits only the regenerated node_modules root", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const generated = path.join(release, "node_modules", "example");
  mkdirSync(generated, { recursive: true });
  appendFileSync(path.join(generated, "index.js"), "export {};\n");

  assert.doesNotThrow(() => verify(release));
});

test("verifier rejects other untracked files in an existing release directory", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  appendFileSync(path.join(release, "runtime-injected.mjs"), "export {};\n");
  assert.throws(
    () => verify(release),
    /unexpected untracked path runtime-injected\.mjs/,
  );
});
