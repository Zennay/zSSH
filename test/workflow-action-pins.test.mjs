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

  for (const name of workflowFiles) {
    const workflow = readFileSync(join(workflowsDir.pathname, name), "utf8");
    const lines = workflow.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      if (!/uses:\s*actions\/checkout@[0-9a-f]{40}\b/i.test(lines[index])) continue;

      const leading = lines[index].match(/^(\s*)/)?.[1] || "";
      const directStep = lines[index].trimStart().startsWith("- uses:");
      const stepIndentLength = directStep ? leading.length : Math.max(0, leading.length - 2);
      const stepPrefix = " ".repeat(stepIndentLength) + "- ";

      let end = index + 1;
      while (end < lines.length && !lines[end].startsWith(stepPrefix)) end += 1;
      const checkoutStep = lines.slice(index, end).join("\n");

      assert.match(
        checkoutStep,
        /persist-credentials:\s*false/,
        `${name}: actions/checkout must set persist-credentials: false`,
      );
    }
  }
});
