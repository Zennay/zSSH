import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readinessWorkflow = readFileSync(
  new URL("../.github/workflows/openai-production-readiness.yml", import.meta.url),
  "utf8",
);
const dnsWorkflow = readFileSync(
  new URL("../.github/workflows/public-dns-publish.yml", import.meta.url),
  "utf8",
);

test("successful production DNS completion automatically reclassifies the M5 gate", () => {
  assert.match(dnsWorkflow, /^name: zSSH production DNS publish$/m);
  assert.match(
    readinessWorkflow,
    /workflow_run:\n    workflows:\n      - zSSH production DNS publish\n      - zSSH public ingress external preflight\n      - Auth0 production readiness\n    types:\n      - completed/,
  );
  assert.match(
    readinessWorkflow,
    /if: github\.event_name != 'workflow_run' \|\| \(github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.head_branch == 'main'\)/,
  );
});

test("post-DNS readiness keeps production mutation permissions out of the audit workflow", () => {
  assert.doesNotMatch(readinessWorkflow, /^\s*actions:\s*write\s*$/m);
  assert.match(readinessWorkflow, /permissions:\n  contents: read\n  pull-requests: read\n  issues: read/);
});
