import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../.github/workflows/public-release-gate.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");
const auth0WorkflowPath = new URL("../.github/workflows/auth0-production-preflight.yml", import.meta.url);
const auth0Workflow = readFileSync(auth0WorkflowPath, "utf8");

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
    "scripts/check-main-protection.mjs",
    "scripts/apply-main-protection.mjs",
    "test/main-provenance.test.mjs",
    "test/main-protection.test.mjs",
    "test/main-protection-apply.test.mjs",
    "test/release-workflow-trigger.test.mjs",
  ]) {
    assert.ok(pushPaths.includes(provenancePath), `push trigger must include ${provenancePath}`);
  }

  for (const governancePath of [
    ".github/workflows/main-protection.yml",
    ".github/workflows/main-protection-negative-proof.yml",
    "scripts/apply-main-protection.mjs",
    "scripts/prove-main-protection-rejection.mjs",
    "test/main-protection-apply.test.mjs",
    "test/main-protection-negative-proof.test.mjs",
    "docs/research/main-branch-protection-2026-10-04.md",
    "docs/research/main-protection-negative-proof-2026-10-04.md",
  ]) {
    assert.ok(
      pullRequestPaths.includes(governancePath),
      `pull_request trigger must include repository-governance path ${governancePath}`,
    );
    assert.ok(
      pushPaths.includes(governancePath),
      `push trigger must include repository-governance path ${governancePath}`,
    );
  }

  for (const readinessPath of [
    ".github/workflows/openai-production-readiness.yml",
    "scripts/check-production-readiness-audit.mjs",
    "test/production-readiness-audit.test.mjs",
  ]) {
    assert.ok(pullRequestPaths.includes(readinessPath), `pull_request trigger must include production-readiness path ${readinessPath}`);
    assert.ok(pushPaths.includes(readinessPath), `push trigger must include production-readiness path ${readinessPath}`);
  }

  for (const authProviderPath of [
    ".github/workflows/auth0-production-preflight.yml",
    ".github/openai-production-auth0-trigger",
    "scripts/check-auth0-production.mjs",
    "test/auth0-production-readiness.test.mjs",
  ]) {
    assert.ok(pullRequestPaths.includes(authProviderPath), `pull_request trigger must include OAuth-provider path ${authProviderPath}`);
    assert.ok(pushPaths.includes(authProviderPath), `push trigger must include OAuth-provider path ${authProviderPath}`);
  }

  for (const runtimePath of [
    "server.mjs",
    "rate-limit.mjs",
    "test/rate-limit.test.mjs",
    "deploy/install-public-gateway.sh",
    "test/public-gateway-installer.test.mjs",
    "deploy/install-public-caddy.sh",
    "test/public-caddy-installer.test.mjs",
    ".github/workflows/public-dns-publish.yml",
    ".github/openai-production-dns-trigger",
    "scripts/publish-cloudflare-dns.mjs",
    "test/cloudflare-dns-publish.test.mjs",
    "test/public-dns-workflow.test.mjs",
  ]) {
    assert.ok(pullRequestPaths.includes(runtimePath), `pull_request trigger must include release-critical runtime path ${runtimePath}`);
    assert.ok(pushPaths.includes(runtimePath), `push trigger must include release-critical runtime path ${runtimePath}`);
  }
});


test("final production release is bound to exact current protected main", () => {
  assert.match(
    workflow,
    /provenance:[\s\S]*Require canonical main ref[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"[\s\S]*Require exact current protected main[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha[\s\S]*production:/,
  );
});


test("final production release reruns and binds the external ingress preflight", () => {
  assert.match(workflow, /- name: Prove external production ingress/);
  assert.match(workflow, /node scripts\/check-public-ingress\.mjs "\$ZSSH_PLUGIN_MCP_URL" \| tee "\$INGRESS_REPORT_PATH"/);
  assert.match(workflow, /Record non-secret release evidence[\s\S]*INGRESS_REPORT_PATH: \$\{\{ runner\.temp \}\}\/zssh-public-ingress-preflight\.json[\s\S]*const ingress = JSON\.parse\(readFileSync\(process\.env\.INGRESS_REPORT_PATH, "utf8"\)\)/);
  assert.match(workflow, /public_ingress_validated: true/);
  assert.match(workflow, /zssh-public-ingress-preflight\.json/);
});


test("reviewed Auth0 activation is bound to protected canonical main", () => {
  assert.match(
    auth0Workflow,
    /push:\n    branches: \[main\][\s\S]*\.github\/openai-production-auth0-trigger/,
  );
  assert.match(
    auth0Workflow,
    /test "\$\(cat \.github\/openai-production-auth0-trigger\)" = "QUALIFY_ZSSH_PRODUCTION_AUTH0"/,
  );
  assert.match(auth0Workflow, /node scripts\/check-main-provenance\.mjs/);
  assert.match(
    auth0Workflow,
    /node scripts\/check-main-protection\.mjs --public-status --require-protected/,
  );
  assert.match(auth0Workflow, /environment: openai-production/);
});

test("manual Auth0 production preflight is bound to exact current protected main", () => {
  assert.match(auth0Workflow, /workflow_dispatch:\s*\n/);
  assert.match(
    auth0Workflow,
    /Require canonical protected-main manual Auth0 preflight[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"/,
  );
  assert.match(
    auth0Workflow,
    /Require canonical protected-main manual Auth0 preflight[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    auth0Workflow,
    /Require canonical protected-main manual Auth0 preflight[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
  );
});
