import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../.github/workflows/public-release-gate.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

function eventPaths(eventName) {
  const lines = workflow.split(/\r?\n/);
  const eventLine = `  ${eventName}:`;
  const eventIndex = lines.findIndex(line => line === eventLine);
  assert.notEqual(eventIndex, -1, `missing ${eventName} trigger`);

  let pathsIndex = -1;
  for (let index = eventIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [a-zA-Z_][^:]*:/.test(line)) break;
    if (line === "    paths:") {
      pathsIndex = index;
      break;
    }
  }
  assert.notEqual(pathsIndex, -1, `missing ${eventName}.paths`);

  const paths = [];
  for (let index = pathsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^      - "(.+)"$/);
    if (!match) break;
    paths.push(match[1]);
  }
  return paths;
}

test("release-critical pull_request and push path filters stay in parity", () => {
  const pullRequestPaths = eventPaths("pull_request");
  const pushPaths = eventPaths("push");

  assert.deepEqual(
    [...pushPaths].sort(),
    [...pullRequestPaths].sort(),
    "post-merge push must rerun the release gate for every release-critical path guarded on pull requests",
  );

  for (const provenancePath of [
    "scripts/check-main-provenance.mjs",
    "test/main-provenance.test.mjs",
    "test/release-workflow-trigger.test.mjs",
  ]) {
    assert.ok(pushPaths.includes(provenancePath), `push trigger must include ${provenancePath}`);
  }

  for (const runtimePath of [
    "server.mjs",
    "rate-limit.mjs",
    "test/rate-limit.test.mjs",
    "deploy/install-public-gateway.sh",
    "test/public-gateway-installer.test.mjs",
  ]) {
    assert.ok(pullRequestPaths.includes(runtimePath), `pull_request trigger must include release-critical runtime path ${runtimePath}`);
    assert.ok(pushPaths.includes(runtimePath), `push trigger must include release-critical runtime path ${runtimePath}`);
  }
});
