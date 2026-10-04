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
  writeFileSync,
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

function verify(release, options = []) {
  return execFileSync(
    process.execPath,
    [VERIFIER, ROOT, HEAD, release, ...options],
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

test("verifier rejects untracked content added to an existing release directory", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(release, ".unexpected.env"), "SECRET=must-not-survive\n");
  assert.throws(
    () => verify(release),
    /unexpected release path: \.unexpected\.env/,
  );
});

test("verifier rejects a tree object hash even when the release contents match", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const treeSha = execFileSync(
    "git",
    ["-C", ROOT, "rev-parse", "HEAD^{tree}"],
    { encoding: "utf8" },
  ).trim();

  assert.throws(
    () => execFileSync(
      process.execPath,
      [VERIFIER, ROOT, treeSha, release],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
    /release SHA must resolve to a commit, got tree/,
  );
});

test("verifier rejects a symlinked release root even when it points to exact contents", t => {
  const { root } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const releaseLink = path.join(root, "release-link");
  symlinkSync("release", releaseLink, "dir");

  assert.throws(
    () => verify(releaseLink),
    /release root must be a real directory, not a symlink/,
  );
});

test("verifier permits only the npm-managed node_modules subtree when explicitly requested", t => {
  const { root, release } = materializeRelease();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const modules = path.join(release, "node_modules");
  mkdirSync(modules);
  writeFileSync(path.join(modules, "runtime-marker.txt"), "managed by npm ci\n");

  assert.throws(
    () => verify(release),
    /unexpected release path: node_modules/,
  );

  const allowed = JSON.parse(verify(release, ["--allow-node-modules"]));
  assert.equal(allowed.ok, true);

  writeFileSync(path.join(release, ".unexpected.env"), "SECRET=still-rejected\n");
  assert.throws(
    () => verify(release, ["--allow-node-modules"]),
    /unexpected release path: \.unexpected\.env/,
  );
});
