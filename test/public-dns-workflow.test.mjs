import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../.github/workflows/public-dns-publish.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");
const runbookPath = new URL(
  "../docs/research/cloudflare-dns-publication-2026-10-04.md",
  import.meta.url,
);
const runbook = readFileSync(runbookPath, "utf8");

test("production DNS publish proves external convergence before reporting success", () => {
  assert.match(
    workflow,
    /Prove public DNS convergence and expose the next live stage[\s\S]*observe-public-origin-readiness\.mjs "\$MCP_URL"/,
  );
  assert.match(workflow, /for attempt in 1 2 3 4 5 6; do/);
  assert.match(
    workflow,
    /if \[ "\$STAGE" != "dns" \]; then[\s\S]*ZSSH_PRODUCTION_DNS_EXTERNALLY_RESOLVABLE stage=\$STAGE/,
  );
  assert.match(
    workflow,
    /Public DNS still does not resolve after bounded convergence checks/,
  );
});

test("post-write verification requires exact automatic TTL and DNS-only mode", () => {
  assert.match(
    workflow,
    /evidence\.action !== "noop"[\s\S]*evidence\.ttl !== 1[\s\S]*evidence\.proxied !== false/,
  );
});

test("post-publication origin evidence is retained with Cloudflare DNS evidence", () => {
  assert.match(
    workflow,
    /zssh-cloudflare-dns-verify\.json[\s\S]*zssh-public-origin-after-dns\.json/,
  );
});


test("reviewed marker can trigger the exact production DNS publish only from current protected main", () => {
  assert.match(workflow, /push:\n    branches: \[main\][\s\S]*\.github\/openai-production-dns-trigger/);
  assert.match(workflow, /test "\$\(cat \.github\/openai-production-dns-trigger\)" = "PUBLISH_ZSSH_PRODUCTION_DNS"/);
  assert.match(
    workflow,
    /Require reviewed protected-main DNS activation[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    workflow,
    /Require reviewed protected-main DNS activation[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
  );
  assert.match(workflow, /CLOUDFLARE_ZONE_NAME: cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_BASE_URL: https:\/\/zssh\.cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_IPV4: 198\.244\.191\.182/);
});

test("production DNS target cannot be overridden by manual dispatch inputs", () => {
  assert.doesNotMatch(workflow, /^      public_base_url:/m);
  assert.doesNotMatch(workflow, /^      ipv4:/m);
  assert.doesNotMatch(workflow, /inputs\.public_base_url/);
  assert.doesNotMatch(workflow, /inputs\.ipv4/);
  assert.match(workflow, /CLOUDFLARE_ZONE_NAME: cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_BASE_URL: https:\/\/zssh\.cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_IPV4: 198\.244\.191\.182/);
});

test("manual production DNS dispatch is bound to the current protected main revision", () => {
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"/,
  );
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
  );
});

test("manual DNS publication keeps confirmation input out of generated shell source", () => {
  const tail = workflow.split("      - name: Require explicit production DNS confirmation")[1];
  assert.ok(tail, "missing manual confirmation step");
  const step = tail.split("\n      - name:")[0];

  assert.match(step, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(step, /ZSSH_DNS_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.match(step, /test "\$ZSSH_DNS_CONFIRMATION" = "PUBLISH_ZSSH_PRODUCTION_DNS"/);
  assert.doesNotMatch(step.split("run: |")[1] || "", /\$\{\{ inputs\.confirmation \}\}/);
});

test("production DNS verifies the provider token read-only before planning any mutation", () => {
  const verifyIndex = workflow.indexOf("      - name: Verify Cloudflare API token is active");
  const planIndex = workflow.indexOf("      - name: Validate desired Cloudflare DNS change without mutation");
  assert.ok(verifyIndex > 0, "missing Cloudflare token verification step");
  assert.ok(planIndex > verifyIndex, "token verification must precede DNS planning");

  const tail = workflow.split("      - name: Verify Cloudflare API token is active")[1];
  const step = tail.split("\n      - name:")[0];
  assert.match(step, /node scripts\/verify-cloudflare-token\.mjs/);
  assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(workflow, /zssh-cloudflare-token-verify\.json[\s\S]*zssh-cloudflare-dns-plan\.json/);
});

test("production DNS replacement is bound to an explicit reviewed existing-record precondition", () => {
  for (const stepName of [
    "Validate desired Cloudflare DNS change without mutation",
    "Publish exact DNS-only A record",
    "Re-read Cloudflare API and prove idempotent desired state",
  ]) {
    const tail = workflow.split("      - name: " + stepName)[1];
    assert.ok(tail, "missing provider step " + stepName);
    const step = tail.split("\n      - name:")[0];
    assert.match(
      step,
      /ZSSH_DNS_EXPECTED_CURRENT_IPV4: \$\{\{ vars\.ZSSH_DNS_EXPECTED_CURRENT_IPV4 \}\}/,
    );
  }

  assert.match(runbook, /ZSSH_DNS_EXPECTED_CURRENT_IPV4/);
  assert.match(runbook, /existing A record/);
});

test("production DNS apply is bound to the exact dry-run record-state fingerprint", () => {
  const planTail = workflow.split("      - name: Validate desired Cloudflare DNS change without mutation")[1];
  assert.ok(planTail, "missing non-mutating DNS plan step");
  const plan = planTail.split("\n      - name:")[0];
  assert.match(plan, /id: dns_plan/);
  assert.match(plan, /evidence\.previous_state_sha256 \|\| ""/);
  assert.match(plan, /would_update_requires_precondition/);
  assert.match(plan, /refusing to enter the mutation-capable step/);
  assert.match(plan, /new Set\(\["noop", "would_create", "would_update"\]\)/);
  assert.match(plan, /action === "would_update"[\s\S]*\^\[a-f0-9\]\{64\}\$/);
  assert.match(plan, /plan_action=\$\{action\}/);
  assert.match(plan, /current_state_sha256=\$\{fingerprint\}/);
  assert.match(plan, /"\$GITHUB_OUTPUT"/);

  const applyTail = workflow.split("      - name: Publish exact DNS-only A record")[1];
  assert.ok(applyTail, "missing DNS apply step");
  const apply = applyTail.split("\n      - name:")[0];
  assert.match(
    apply,
    /if: steps\.dns_plan\.outputs\.plan_action == 'would_create' \|\| steps\.dns_plan\.outputs\.plan_action == 'would_update'/,
  );
  assert.match(
    apply,
    /ZSSH_DNS_EXPECTED_CURRENT_STATE_SHA256: \$\{\{ steps\.dns_plan\.outputs\.current_state_sha256 \}\}/,
  );
  assert.match(
    apply,
    /ZSSH_DNS_EXPECTED_PLAN_ACTION: \$\{\{ steps\.dns_plan\.outputs\.plan_action \}\}/,
  );
  assert.doesNotMatch(
    apply,
    /ZSSH_DNS_EXPECTED_CURRENT_STATE_SHA256: \$\{\{ vars\./,
  );

  assert.match(runbook, /plan-to-apply/);
  assert.match(runbook, /state fingerprint/i);
});

test("production DNS apply carries the exact reviewed plan action into the reconciler", () => {
  const applyTail = workflow.split("      - name: Publish exact DNS-only A record")[1];
  assert.ok(applyTail, "missing DNS apply step");
  const apply = applyTail.split("\n      - name:")[0];

  assert.match(
    apply,
    /ZSSH_DNS_EXPECTED_PLAN_ACTION: \$\{\{ steps\.dns_plan\.outputs\.plan_action \}\}/,
  );
  assert.match(runbook, /binds the apply step to that exact plan action/i);
});

test("production DNS skips the mutation-capable apply step for an already-converged noop plan", () => {
  const applyTail = workflow.split("      - name: Publish exact DNS-only A record")[1];
  assert.ok(applyTail, "missing DNS apply step");
  const apply = applyTail.split("\n      - name:")[0];

  assert.match(
    apply,
    /if: steps\.dns_plan\.outputs\.plan_action == 'would_create' \|\| steps\.dns_plan\.outputs\.plan_action == 'would_update'/,
  );
  assert.doesNotMatch(apply, /plan_action == 'noop'/);
  assert.match(runbook, /noop.*apply step.*skipped/i);
});

test("production DNS never enters the apply step when human replacement review is missing", () => {
  const planIndex = workflow.indexOf("      - name: Validate desired Cloudflare DNS change without mutation");
  const applyIndex = workflow.indexOf("      - name: Publish exact DNS-only A record");
  assert.ok(planIndex > 0 && applyIndex > planIndex, "plan must precede apply");

  const plan = workflow
    .slice(planIndex, applyIndex);
  assert.match(plan, /action === "would_update_requires_precondition"/);
  assert.match(plan, /throw new Error\([\s\S]*reviewed ZSSH_DNS_EXPECTED_CURRENT_IPV4/);
  assert.match(runbook, /stops the protected workflow \*\*before the mutation-capable apply step\*\*/i);
});

test("operator DNS cutover runbook stays aligned with the guarded workflow contract", () => {
  const workflowName = workflow.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const confirmationPhrase = workflow.match(
    /description:\s*Type\s+([A-Z0-9_]+)\s+to permit the DNS write/,
  )?.[1];

  assert.ok(workflowName, "production DNS workflow must expose a name");
  assert.ok(confirmationPhrase, "manual DNS workflow must expose its confirmation phrase");
  assert.ok(
    runbook.includes(`Dispatch **${workflowName}** from canonical \`main\``),
    "operator runbook must name the real guarded DNS workflow",
  );
  assert.ok(
    runbook.includes(`exact confirmation phrase \`${confirmationPhrase}\``),
    "operator runbook must carry the real workflow confirmation phrase",
  );
  assert.match(
    runbook,
    /GitHub \`openai-production\` environment[\s\S]*protected secret \`CLOUDFLARE_API_TOKEN\`/,
  );
  assert.match(runbook, /My Profile > API Tokens/);
  assert.match(runbook, /user-owned token/i);
  assert.match(runbook, /account-owned API token/i);
  assert.match(runbook, /Zone > DNS > Edit[\s\S]*Zone > Zone > Read/);
  assert.match(runbook, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(runbook, /\/accounts\/\{account_id\}\/tokens\/verify/);
  assert.match(runbook, /\/user\/tokens\/verify/);
  assert.match(runbook, /Cloudflare re-read returning the idempotent \`noop\` state/);
  assert.match(runbook, /external DNS observation advancing beyond the \`dns\` stage/);
});

test("production DNS workflow pins all reusable actions to immutable commit SHAs", () => {
  assert.match(
    workflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1/,
  );
  assert.match(
    workflow,
    /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0/,
  );
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1/,
  );
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\s|$)/);
});

test("operator DNS runbook names the reviewed Node 24 v7 action generation", () => {
  assert.match(runbook, /Node 24-compatible v7 releases/);
  assert.match(runbook, /actions\/checkout.*v7\.0\.1.*3d3c42e5aac5ba805825da76410c181273ba90b1/s);
  assert.match(runbook, /actions\/setup-node.*v7\.0\.0.*820762786026740c76f36085b0efc47a31fe5020/s);
  assert.match(runbook, /actions\/upload-artifact.*v7\.0\.1.*043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/s);
  assert.doesNotMatch(runbook, /reviewed v4 releases/);
});


test("Cloudflare provider credential is unavailable before canonical provenance", () => {
  const jobHeader = workflow.split("    steps:")[0];
  assert.doesNotMatch(jobHeader, /CLOUDFLARE_API_TOKEN/);

  for (const stepName of [
    "Verify Cloudflare API token is active",
    "Validate desired Cloudflare DNS change without mutation",
    "Publish exact DNS-only A record",
    "Re-read Cloudflare API and prove idempotent desired state",
  ]) {
    const tail = workflow.split(`      - name: ${stepName}`)[1];
    assert.ok(tail, `missing provider step ${stepName}`);
    const step = tail.split("\n      - name:")[0];
    assert.match(
      step,
      /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/,
      `${stepName} must receive the Cloudflare token explicitly`,
    );
  }
});
