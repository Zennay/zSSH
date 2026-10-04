import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const supportedNode = "22.23.3";

test("active GitHub workflows use the reviewed supported Node.js runtime", () => {
  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  assert.ok(workflowFiles.length > 0);

  let runtimeRefs = 0;
  for (const name of workflowFiles) {
    const workflow = readFileSync(join(workflowsDir.pathname, name), "utf8");
    const versions = [...workflow.matchAll(/node-version:\s*([^\s#]+)/g)]
      .map((match) => match[1]);

    for (const version of versions) {
      runtimeRefs += 1;
      assert.equal(
        version,
        supportedNode,
        `${name}: setup-node must use reviewed Node.js ${supportedNode}, found ${version}`,
      );
    }
  }

  assert.ok(runtimeRefs > 0, "expected at least one setup-node runtime pin");
});

test("active workflows do not reintroduce the EOL Node.js 20 release line", () => {
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const workflow = readFileSync(join(workflowsDir.pathname, name), "utf8");
    assert.doesNotMatch(
      workflow,
      /node-version:\s*(?:['"])?20(?:[.'"]|\s|$)/,
      `${name}: Node.js 20 is EOL and must not be used by active release workflows`,
    );
  }
});
