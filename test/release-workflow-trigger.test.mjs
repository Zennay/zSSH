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

  assert.ok(
    pullRequestPaths.includes(".github/workflows/**"),
    "pull_request release gate must cover every active GitHub Actions workflow",
  );
  assert.ok(
    pushPaths.includes(".github/workflows/**"),
    "push release gate must cover every active GitHub Actions workflow",
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
    "package.json",
    "package-lock.json",
    "test/runtime-dependency-policy.test.mjs",
    "test/workflow-node-runtime.test.mjs",
    "docs/research/node-runtime-support-2026-10-04.md",
    "server.mjs",
    "rate-limit.mjs",
    "test/rate-limit.test.mjs",
    "deploy/install-live.sh",
    "deploy/install-target-agent.sh",
    "test/install-live-stage-provenance.test.mjs",
    "scripts/verify-release-provenance.mjs",
    "test/release-provenance-verifier.test.mjs",
    "deploy/install-public-gateway.sh",
    "test/public-gateway-installer.test.mjs",
    "deploy/install-public-caddy.sh",
    "test/public-caddy-installer.test.mjs",
    "deploy/prepare-reviewer-target.sh",
    "scripts/prepare-review-target.mjs",
    "scripts/reviewer-fixture-contract.mjs",
    "test/reviewer-target-bootstrap.test.mjs",
    ".github/workflows/public-dns-publish.yml",
    ".github/openai-production-dns-trigger",
    "scripts/publish-cloudflare-dns.mjs",
    "test/cloudflare-dns-publish.test.mjs",
    "test/cloudflare-request-timeout.test.mjs",
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


test("final production release fingerprints and retains the exact dependency lockfile", () => {
  assert.match(workflow, /import \{ createHash \} from "node:crypto";/);
  assert.match(
    workflow,
    /createHash\("sha256"\)[\s\S]*\.update\(readFileSync\("package-lock\.json"\)\)[\s\S]*\.digest\("hex"\)/,
  );
  assert.match(workflow, /dependency_lock_sha256: dependencyLockSha256/);
  assert.match(
    workflow,
    /Upload release bundle and evidence[\s\S]*dist\/zssh-openai-plugin\.zip[\s\S]*package-lock\.json[\s\S]*if-no-files-found: error/,
  );
});


test("final production release proves and records the reviewed Node/npm toolchain", () => {
  assert.match(workflow, /Verify reviewed Node\/npm toolchain[\s\S]*test "\$\(node --version\)" = "v22\.23\.3"[\s\S]*test "\$\(npm --version\)" = "10\.9\.9"/);
  assert.match(workflow, /import \{ execFileSync \} from "node:child_process";/);
  assert.match(workflow, /const nodeVersion = process\.version\.replace\(\/\^v\/, ""\);/);
  assert.match(workflow, /execFileSync\("npm", \["--version"\], \{ encoding: "utf8" \}\)\.trim\(\)/);
  assert.match(workflow, /node_version: nodeVersion/);
  assert.match(workflow, /npm_version: npmVersion/);
});

test("final production release scopes protected secrets to only required steps", () => {
  const productionStart = workflow.indexOf("  production:");
  assert.ok(productionStart >= 0, "missing final production job");
  const production = workflow.slice(productionStart);
  const productionHeader = production.split("\n    steps:")[0] || "";

  for (const secretName of [
    "ZSSH_REVIEW_ACCESS_TOKEN",
    "AUTH0_MANAGEMENT_API_TOKEN",
    "OPENAI_APPS_CHALLENGE_TOKEN",
  ]) {
    assert.doesNotMatch(
      productionHeader,
      new RegExp(secretName),
      `${secretName} must not be available to every final-release step`,
    );
  }

  function step(name) {
    const tail = production.split(`      - name: ${name}`)[1];
    assert.ok(tail, `missing ${name} step`);
    return tail.split("\n      - name:")[0] || "";
  }

  const presence = step("Record secret-safe release configuration presence");
  const validation = step("Fail closed on incomplete or non-public release configuration");
  for (const secretName of [
    "ZSSH_REVIEW_ACCESS_TOKEN",
    "AUTH0_MANAGEMENT_API_TOKEN",
    "OPENAI_APPS_CHALLENGE_TOKEN",
  ]) {
    const secretReference = secretName + ": " + "${{ secrets." + secretName + " }}";
    assert.ok(presence.includes(secretReference), `${secretName} must be available to presence classification`);
    assert.ok(validation.includes(secretReference), `${secretName} must be available to final config validation`);
  }

  const auth0 = step("Prove Auth0 production tenant, API and DCR grant");
  assert.ok(auth0.includes("AUTH0_MANAGEMENT_API_TOKEN: ${{ secrets.AUTH0_MANAGEMENT_API_TOKEN }}"));
  assert.doesNotMatch(auth0, /ZSSH_REVIEW_ACCESS_TOKEN|OPENAI_APPS_CHALLENGE_TOKEN/);

  const probe = step("Run end-to-end OpenAI submission probe");
  assert.ok(probe.includes("ZSSH_REVIEW_ACCESS_TOKEN: ${{ secrets.ZSSH_REVIEW_ACCESS_TOKEN }}"));
  assert.ok(probe.includes("OPENAI_APPS_CHALLENGE_TOKEN: ${{ secrets.OPENAI_APPS_CHALLENGE_TOKEN }}"));
  assert.doesNotMatch(probe, /AUTH0_MANAGEMENT_API_TOKEN/);

  for (const secretFreeStep of [
    "Prove external production ingress",
    "Upload preflight evidence",
    "Bind Verify Domain evidence to exact production origin",
    "Build exact OpenAI submission bundle",
    "Bind portal Scan Tools evidence to exact live contract",
    "Record non-secret release evidence",
    "Upload release bundle and evidence",
  ]) {
    assert.doesNotMatch(
      step(secretFreeStep),
      /ZSSH_REVIEW_ACCESS_TOKEN|AUTH0_MANAGEMENT_API_TOKEN|OPENAI_APPS_CHALLENGE_TOKEN/,
      `${secretFreeStep} must remain secret-free`,
    );
  }
});


test("reviewed Auth0 activation is bound to exact current protected main", () => {
  assert.match(
    auth0Workflow,
    /push:\n    branches: \[main\][\s\S]*\.github\/openai-production-auth0-trigger/,
  );
  assert.match(
    auth0Workflow,
    /test "\$\(cat \.github\/openai-production-auth0-trigger\)" = "QUALIFY_ZSSH_PRODUCTION_AUTH0"/,
  );
  assert.match(
    auth0Workflow,
    /Require reviewed protected-main Auth0 activation[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    auth0Workflow,
    /Require reviewed protected-main Auth0 activation[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
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


test("Auth0 management credential is unavailable before canonical provenance", () => {
  const jobHeader = auth0Workflow.split("    steps:")[0];
  assert.doesNotMatch(jobHeader, /AUTH0_MANAGEMENT_API_TOKEN/);

  const validationTail = auth0Workflow.split("      - name: Validate Auth0 tenant, API and DCR grant")[1];
  assert.ok(validationTail, "missing Auth0 provider validation step");
  const validationStep = validationTail.split("\n      - name:")[0];
  assert.match(
    validationStep,
    /AUTH0_MANAGEMENT_API_TOKEN: \$\{\{ secrets\.AUTH0_MANAGEMENT_API_TOKEN \}\}/,
  );

  const reviewedTail = auth0Workflow.split("      - name: Require reviewed protected-main Auth0 activation")[1];
  assert.ok(reviewedTail, "missing reviewed Auth0 provenance step");
  const reviewedStep = reviewedTail.split("\n      - name:")[0];
  assert.doesNotMatch(reviewedStep, /AUTH0_MANAGEMENT_API_TOKEN/);
});


test("every release-critical test trigger is executed by the release contract job", () => {
  const pullRequestPaths = eventPaths("pull_request").filter(path => path.startsWith("test/") && path.endsWith(".test.mjs"));
  const contractStep = workflow
    .split("      - name: Exercise release and portal binding contracts")[1]
    ?.split("\n      - name:")[0] || "";

  for (const testPath of pullRequestPaths) {
    assert.ok(
      contractStep.includes(testPath),
      `release-critical test trigger must be executed by release contract job: ${testPath}`,
    );
  }
});
