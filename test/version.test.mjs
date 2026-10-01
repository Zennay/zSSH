import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION, parsePackageVersion } from "../version.mjs";

const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const pluginMetadata = JSON.parse(
  readFileSync(new URL("../submission/plugin.template.json", import.meta.url), "utf8"),
);

test("runtime, package and public plugin versions stay aligned", () => {
  assert.equal(VERSION, packageMetadata.version);
  assert.equal(VERSION, pluginMetadata.version);
});

test("package version parser fails closed", () => {
  assert.equal(parsePackageVersion('{"version":"1.2.3-beta.1+build.7"}'), "1.2.3-beta.1+build.7");
  assert.throws(() => parsePackageVersion('{"version":"latest"}'), /semantic version/);
  assert.throws(() => parsePackageVersion("not-json"), /valid JSON/);
});
