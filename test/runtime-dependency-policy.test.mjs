import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packagePath = new URL("../package.json", import.meta.url);
const lockPath = new URL("../package-lock.json", import.meta.url);
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

test("release package metadata pins the reviewed npm toolchain", () => {
  assert.equal(pkg.packageManager, "npm@10.9.9");
});

test("production runtime dependencies use exact semver versions", () => {
  const dependencies = Object.entries(pkg.dependencies || {});
  assert.ok(dependencies.length > 0, "expected at least one production runtime dependency");

  for (const [name, version] of dependencies) {
    assert.match(
      String(version),
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `runtime dependency ${name} must use an exact version, got ${version}`,
    );
  }
});

test("npm lockfile pins the complete production dependency graph", () => {
  assert.equal(lock.lockfileVersion, 3, "package-lock.json must use npm lockfileVersion 3");
  assert.deepEqual(
    lock.packages?.[""]?.dependencies,
    pkg.dependencies,
    "package-lock root dependencies must exactly match package.json",
  );

  const packages = Object.entries(lock.packages || {}).filter(([path]) => path !== "");
  assert.ok(packages.length > 0, "package-lock.json must contain transitive packages");

  for (const [path, metadata] of packages) {
    assert.match(
      String(metadata.version || ""),
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${path} must have an exact locked version`,
    );
    assert.match(
      String(metadata.resolved || ""),
      /^https:\/\/registry\.npmjs\.org\//,
      `${path} must resolve from the reviewed npm registry`,
    );
    assert.match(
      String(metadata.integrity || ""),
      /^sha512-/,
      `${path} must carry an npm SHA-512 integrity digest`,
    );
  }
});


test("release-critical installs use the committed lockfile via npm ci", () => {
  const workflowPaths = [
    "../.github/workflows/ci.yml",
    "../.github/workflows/public-release-gate.yml",
  ];
  for (const relative of workflowPaths) {
    const content = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(content, /test "\$\(node --version\)" = "v22\.23\.3"/);
    assert.match(content, /test "\$\(npm --version\)" = "10\.9\.9"/);
    assert.match(content, /npm ci --ignore-scripts --no-audit --no-fund/);
    assert.doesNotMatch(content, /npm install --ignore-scripts --no-audit --no-fund/);
  }

  for (const relative of [
    "../deploy/install-live.sh",
    "../deploy/install-target-agent.sh",
    "../deploy/install-public-gateway.sh",
  ]) {
    const content = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(content, /"\$NPM_BIN" ci --prefix "\$STAGE" --omit=dev --ignore-scripts --no-audit --no-fund/);
    assert.doesNotMatch(content, /"\$NPM_BIN" install --prefix "\$STAGE"/);
  }
});
