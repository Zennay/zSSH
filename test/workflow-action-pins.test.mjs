import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);

test("all active GitHub Actions use immutable full commit SHAs", () => {
  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  assert.ok(workflowFiles.length > 0);

  for (const name of workflowFiles) {
    const workflow = readFileSync(join(workflowsDir.pathname, name), "utf8");
    const refs = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);

    for (const ref of refs) {
      if (ref.startsWith("./")) continue;
      const at = ref.lastIndexOf("@");
      assert.notEqual(at, -1, `${name}: external action has no ref: ${ref}`);
      const version = ref.slice(at + 1);
      assert.match(
        version,
        /^[0-9a-f]{40}$/i,
        `${name}: external action must be pinned to a full 40-character commit SHA: ${ref}`,
      );
    }
  }
});

test("all active checkout steps disable persisted Git credentials", () => {
  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  let checkoutCount = 0;
  for (const name of workflowFiles) {
    const workflow = readFileSync(join(workflowsDir.pathname, name), "utf8");
    const lines = workflow.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const start = lines[index].match(/^(\s*)-\s+uses:\s+actions\/checkout@[^\s#]+(?:\s+#.*)?$/);
      if (!start) continue;

      checkoutCount += 1;
      const stepIndent = start[1].length;
      const block = [lines[index]];

      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        const nextStep = line.match(/^(\s*)-\s+/);
        if (nextStep && nextStep[1].length === stepIndent) break;
        if (line.trim() && line.search(/\S/) < stepIndent) break;
        block.push(line);
      }

      assert.match(
        block.join("\n"),
        /persist-credentials:\s*false/,
        `${name}: actions/checkout must set persist-credentials: false`,
      );
    }
  }

  assert.ok(checkoutCount > 0, "expected at least one active actions/checkout step");
});
