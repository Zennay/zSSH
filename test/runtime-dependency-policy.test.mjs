import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packagePath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

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
