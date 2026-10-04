import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readinessWorkflow = readFileSync(
  new URL("../.github/workflows/openai-production-readiness.yml", import.meta.url),
  "utf8",
);
const auth0Workflow = readFileSync(
  new URL("../.github/workflows/auth0-production-preflight.yml", import.meta.url),
  "utf8",
);
const publicReleaseWorkflow = readFileSync(
  new URL("../.github/workflows/public-release-gate.yml", import.meta.url),
  "utf8",
);
const releaseChecklist = readFileSync(
  new URL("../docs/openai-plugin-release-checklist.md", import.meta.url),
  "utf8",
);
const reviewDoc = readFileSync(
  new URL("../docs/openai-plugin-review.md", import.meta.url),
  "utf8",
);
import { computeHostSurfaceReviewFingerprint } from "../scripts/check-host-surface-review-binding.mjs";
import { buildProductionReadinessAudit } from "../scripts/check-production-readiness-audit.mjs";
import {
  REVIEW_READ_FILE,
  REVIEW_WRITE_FILE,
} from "../scripts/reviewer-fixture-contract.mjs";

const pluginTemplate = JSON.parse(readFileSync(
  new URL("../submission/plugin.template.json", import.meta.url),
  "utf8",
));

const complete = {
  CLOUDFLARE_ZONE_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_API_TOKEN: "placeholder-cf-value",
  ZSSH_PUBLIC_ORIGIN_STAGE: "ready",
  ZSSH_PLUGIN_MCP_URL: "https://zssh.cheapgpt.shop/mcp",
  ZSSH_PLUGIN_DEMO_RECORDING_URL: "https://review.zssh.dev/zssh-demo",
  ZSSH_REVIEW_ACCESS_TOKEN: "placeholder-review-value",
  ZSSH_REVIEW_LOGIN_URL: "https://tenant.eu.auth0.com/u/login",
  ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://tenant.eu.auth0.com/u/login",
  ZSSH_REVIEW_CREDENTIALS_VERIFIED: "1",
  ZSSH_MAIN_PROTECTION_VERIFIED: "1",
  ZSSH_MAIN_BRANCH_PROTECTED: "1",
  ZSSH_CHATGPT_DESKTOP_REVIEWED: "1",
  ZSSH_CHATGPT_MOBILE_REVIEWED: "1",
  ZSSH_OPENAI_DOMAIN_VERIFIED: "1",
  ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://zssh.cheapgpt.shop",
  ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "1",
  ZSSH_OPENAI_TOOL_SCAN_SHA256: "b".repeat(64),
  ZSSH_OAUTH_ISSUER: "https://tenant.eu.auth0.com/",
  AUTH0_MANAGEMENT_BASE_URL: "https://tenant.eu.auth0.com",
  AUTH0_MANAGEMENT_API_TOKEN: "placeholder-auth0-value",
  ZSSH_AUTH0_PREFLIGHT_ATTEMPTED: "1",
  ZSSH_AUTH0_PREFLIGHT_VERIFIED: "1",
  OPENAI_APPS_CHALLENGE_TOKEN: "placeholder-challenge-value",
  ZSSH_REVIEW_FILE: REVIEW_READ_FILE,
  ZSSH_REVIEW_WRITE_FILE: REVIEW_WRITE_FILE,
};
complete.ZSSH_CHATGPT_REVIEW_SHA256 = computeHostSurfaceReviewFingerprint({
  mcpUrl: complete.ZSSH_PLUGIN_MCP_URL,
  toolScanSha256: complete.ZSSH_OPENAI_TOOL_SCAN_SHA256,
}).fingerprint;

test("classifies an empty production environment into actionable M5 lanes", () => {
  const result = buildProductionReadinessAudit({});
  assert.equal(result.schema_version, 5);
  assert.equal(result.phase, "M5");
  assert.equal(result.execution_state, "internal_action_available");
  assert.deepEqual(result.internal_action_gates, ["repository_governance"]);
  assert.equal(result.blocking_gate, "repository_governance");
  assert.equal(result.blocking_action?.requires_external_input, false);
  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, false);
  assert.equal(result.ready.auth0_preflight, false);
  assert.equal(result.ready.final_release_config, false);
  assert.deepEqual(result.lanes.dns_publication.missing, [
    "CLOUDFLARE_API_TOKEN",
  ]);
  assert.deepEqual(result.lanes.dns_publication.invalid, []);
  assert.equal(result.next_actions[0].lane, "repository_governance");
  assert.equal(result.next_actions[0].gate_kind, "derived_evidence");
  assert.equal(result.next_actions[0].requires_external_input, false);
  assert.equal(result.next_actions[0].action.includes("set ZSSH_MAIN_PROTECTION_VERIFIED"), false);
  assert.equal(result.next_actions[1].lane, "dns_publication");
  assert.equal(result.next_actions[1].gate_kind, "provider_credentials");
  assert.equal(result.next_actions[1].requires_external_input, true);
  assert.match(result.next_actions[1].action, /account-owned token/i);
  assert.match(result.next_actions[1].action, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(result.next_actions[1].action, /user-owned tokens/i);
  assert.match(result.next_actions[1].action, /My Profile > API Tokens/);
  assert.match(result.next_actions[1].action, /\/accounts\/\{account_id\}\/tokens\/verify/);
  assert.match(result.next_actions[1].action, /\/user\/tokens\/verify/);
  assert.equal(result.next_actions[2].lane, "auth0_preflight");
  assert.equal(result.next_actions[2].gate_kind, "provider_configuration");
  assert.equal(result.next_actions[2].requires_external_input, true);
  assert.match(result.next_actions[2].action, /production Auth0 issuer and Management API token/);
  assert.match(result.next_actions[2].action, /protected readiness audit performs the live Auth0 tenant\/API\/DCR qualification/);
  assert.deepEqual(result.external_input_gates, [
    "dns_publication",
    "auth0_preflight",
    "reviewer_fixture",
    "portal_and_host_attestations",
  ]);
});

test("treats Cloudflare zone ID as an optional legacy override", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    CLOUDFLARE_ZONE_ID: "",
  });
  assert.equal(result.ready.dns_publication, true);
  assert.deepEqual(result.lanes.dns_publication.missing, []);
});

test("keeps DNS as an internal execution gate when credentials exist but public DNS has not converged", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_PUBLIC_ORIGIN_STAGE: "dns",
  });

  assert.equal(result.ready.dns_publication, false);
  assert.deepEqual(result.lanes.dns_publication.missing, []);
  assert.equal(result.blocking_gate, "dns_publication");
  assert.equal(result.blocking_action?.gate_kind, "provider_execution");
  assert.equal(result.blocking_action?.requires_external_input, false);
  assert.match(result.blocking_action?.action || "", /Run the guarded zSSH production DNS publisher/);
  assert.match(result.blocking_action?.action || "", /\.github\/openai-production-dns-trigger/);
  assert.match(result.blocking_action?.action || "", /PUBLISH_ZSSH_PRODUCTION_DNS/);
  assert.match(result.blocking_action?.action || "", /activation-id=<8-80 safe characters>/);
  assert.deepEqual(result.internal_action_gates, ["dns_publication"]);
});

test("keeps completed DNS green and exposes the remaining internal ingress rollout", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    CLOUDFLARE_API_TOKEN: "",
    ZSSH_PUBLIC_ORIGIN_STAGE: "mcp_auth",
  });

  assert.equal(result.ready.dns_publication, true);
  assert.equal(result.ready.public_ingress, false);
  assert.deepEqual(result.lanes.dns_publication.missing, []);
  assert.equal(result.blocking_gate, "public_ingress");
  assert.equal(result.blocking_action?.gate_kind, "internal_deployment");
  assert.equal(result.blocking_action?.requires_external_input, false);
  assert.match(result.blocking_action?.action || "", /zssh-public\.service/);
  assert.match(result.blocking_action?.action || "", /Caddy promotion/);
  assert.deepEqual(result.internal_action_gates, ["public_ingress"]);
});

test("treats the public ingress boundary as proven once health and MCP auth reach OAuth metadata", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_PUBLIC_ORIGIN_STAGE: "oauth_metadata",
    ZSSH_OAUTH_ISSUER: "",
    AUTH0_MANAGEMENT_BASE_URL: "",
    AUTH0_MANAGEMENT_API_TOKEN: "",
  });

  assert.equal(result.ready.dns_publication, true);
  assert.equal(result.ready.public_ingress, true);
  assert.equal(result.blocking_gate, "auth0_preflight");
  assert.equal(result.blocking_action?.requires_external_input, true);
  assert.deepEqual(result.internal_action_gates, []);
});

test("does not treat configured Auth0 inputs as qualified without live provider evidence", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_AUTH0_PREFLIGHT_ATTEMPTED: "",
    ZSSH_AUTH0_PREFLIGHT_VERIFIED: "",
  });

  assert.equal(result.ready.auth0_preflight, false);
  assert.deepEqual(result.lanes.auth0_preflight.missing, []);
  assert.equal(result.blocking_gate, "auth0_preflight");
  assert.equal(result.blocking_action?.gate_kind, "provider_execution");
  assert.equal(result.blocking_action?.requires_external_input, false);
  assert.match(result.blocking_action?.action || "", /check-auth0-production\.mjs/);
});

test("classifies failed live Auth0 qualification as provider configuration", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_AUTH0_PREFLIGHT_ATTEMPTED: "1",
    ZSSH_AUTH0_PREFLIGHT_VERIFIED: "",
  });

  assert.equal(result.ready.auth0_preflight, false);
  assert.equal(result.blocking_gate, "auth0_preflight");
  assert.equal(result.blocking_action?.gate_kind, "provider_configuration");
  assert.equal(result.blocking_action?.requires_external_input, true);
  assert.match(result.blocking_action?.action || "", /Live Auth0 production qualification failed/);
});

test("derives Auth0 management origin for canonical tenant issuers", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    AUTH0_MANAGEMENT_BASE_URL: "",
  });

  assert.equal(result.ready.auth0_preflight, true);
  assert.equal(result.lanes.auth0_preflight.configured.AUTH0_MANAGEMENT_BASE_URL, true);
  assert.deepEqual(result.lanes.auth0_preflight.missing, []);
  assert.equal(result.ready.final_release_config, true);
});

test("requires explicit canonical Auth0 management origin for custom issuer domains", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_OAUTH_ISSUER: "https://login.cheapgpt.shop/",
    AUTH0_MANAGEMENT_BASE_URL: "",
  });

  assert.equal(result.ready.auth0_preflight, false);
  assert.ok(result.lanes.auth0_preflight.missing.includes("AUTH0_MANAGEMENT_BASE_URL"));
  assert.equal(result.ready.final_release_config, false);
  assert.ok(result.final_release_config.missing.includes("AUTH0_MANAGEMENT_BASE_URL"));
});

test("reports external-input-only when no repository-owned action remains", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    CLOUDFLARE_ZONE_ID: "",
    CLOUDFLARE_API_TOKEN: "",
    ZSSH_PUBLIC_ORIGIN_STAGE: "dns",
    ZSSH_OAUTH_ISSUER: "",
    AUTH0_MANAGEMENT_BASE_URL: "",
    AUTH0_MANAGEMENT_API_TOKEN: "",
    ZSSH_PLUGIN_DEMO_RECORDING_URL: "",
    ZSSH_REVIEW_ACCESS_TOKEN: "",
    ZSSH_REVIEW_LOGIN_URL: "",
  });

  assert.equal(result.execution_state, "external_input_only");
  assert.deepEqual(result.internal_action_gates, []);
  assert.deepEqual(result.external_input_gates, [
    "dns_publication",
    "auth0_preflight",
    "reviewer_fixture",
  ]);
  assert.equal(result.blocking_gate, "dns_publication");
  assert.equal(result.blocking_action?.lane, "dns_publication");
  assert.equal(result.blocking_action?.requires_external_input, true);
});

test("rejects malformed configured values instead of reporting a false-ready lane", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_MAIN_PROTECTION_VERIFIED: "0",
    ZSSH_MAIN_BRANCH_PROTECTED: "0",
    CLOUDFLARE_ZONE_ID: "not-a-zone",
    CLOUDFLARE_ACCOUNT_ID: "not-an-account",
    ZSSH_OAUTH_ISSUER: "http://tenant.example.test/",
    AUTH0_MANAGEMENT_API_TOKEN: "short",
    ZSSH_PLUGIN_DEMO_RECORDING_URL: "https://127.0.0.1/demo",
    ZSSH_REVIEW_CREDENTIALS_VERIFIED: "0",
  });

  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, false);
  assert.equal(result.ready.auth0_preflight, false);
  assert.equal(result.ready.reviewer_fixture, false);
  assert.equal(result.ready.portal_and_host_attestations, false);

  assert.deepEqual(
    result.lanes.repository_governance.invalid.map(item => item.name),
    ["ZSSH_MAIN_PROTECTION_VERIFIED", "ZSSH_MAIN_BRANCH_PROTECTED"],
  );
  assert.deepEqual(
    result.lanes.dns_publication.invalid.map(item => item.name),
    ["CLOUDFLARE_ZONE_ID", "CLOUDFLARE_ACCOUNT_ID"],
  );
  assert.deepEqual(
    result.lanes.auth0_preflight.invalid.map(item => item.name),
    ["ZSSH_OAUTH_ISSUER", "AUTH0_MANAGEMENT_API_TOKEN"],
  );
  assert.ok(
    result.lanes.reviewer_fixture.invalid.some(
      item => item.name === "ZSSH_PLUGIN_DEMO_RECORDING_URL" && item.reason.includes("public DNS hostname"),
    ),
  );
  assert.ok(
    result.lanes.portal_and_host_attestations.invalid.some(
      item => item.name === "ZSSH_REVIEW_CREDENTIALS_VERIFIED",
    ),
  );
});

test("classifies malformed Cloudflare account ID as provider configuration before DNS execution", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    CLOUDFLARE_ACCOUNT_ID: "bad-account-id",
    ZSSH_PUBLIC_ORIGIN_STAGE: "dns",
  });

  assert.equal(result.ready.dns_publication, false);
  assert.equal(result.blocking_gate, "dns_publication");
  assert.equal(result.blocking_action?.gate_kind, "provider_configuration");
  assert.equal(result.blocking_action?.requires_external_input, true);
  assert.deepEqual(
    result.lanes.dns_publication.invalid.map(item => item.name),
    ["CLOUDFLARE_ACCOUNT_ID"],
  );
  assert.match(result.blocking_action?.action || "", /CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(result.blocking_action?.action || "", /Run the guarded zSSH production DNS publisher/);
});

test("rejects demo recording URL fragments before the final production probe", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_PLUGIN_DEMO_RECORDING_URL: "https://review.zssh.dev/zssh-demo#chapter",
  });

  assert.equal(result.ready.reviewer_fixture, false);
  assert.ok(
    result.lanes.reviewer_fixture.invalid.some(
      item =>
        item.name === "ZSSH_PLUGIN_DEMO_RECORDING_URL" &&
        item.reason.includes("fragment"),
    ),
  );
  assert.equal(result.ready.final_release_config, false);
});

test("reports provider lanes independently from later portal attestations", () => {
  const env = {
    ...complete,
    ZSSH_OPENAI_DOMAIN_VERIFIED: "",
    ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "",
    ZSSH_CHATGPT_DESKTOP_REVIEWED: "",
    ZSSH_CHATGPT_MOBILE_REVIEWED: "",
  };
  const result = buildProductionReadinessAudit(env);
  assert.equal(result.ready.dns_publication, true);
  assert.equal(result.ready.auth0_preflight, true);
  assert.equal(result.ready.reviewer_fixture, true);
  assert.equal(result.ready.portal_and_host_attestations, false);
  assert.equal(result.ready.final_release_config, false);
  assert.deepEqual(
    result.next_actions.map(item => item.lane),
    ["portal_and_host_attestations"],
  );
});

test("keeps repository governance independent from provider and portal lanes", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_MAIN_PROTECTION_VERIFIED: "",
    ZSSH_MAIN_BRANCH_PROTECTED: "1",
  });
  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, true);
  assert.equal(result.ready.auth0_preflight, true);
  assert.equal(result.ready.reviewer_fixture, true);
  assert.equal(result.ready.portal_and_host_attestations, true);
  assert.equal(result.ready.final_release_config, false);
  assert.deepEqual(result.next_actions.map(item => item.lane), ["repository_governance"]);
});

test("binds reviewer fixture configuration to the exact submitted review prompts", () => {
  const cases = pluginTemplate.extensions["com.openai"].review.test_cases.positive;
  assert.ok(cases.some(item => item.prompt.includes(REVIEW_READ_FILE)));
  assert.ok(cases.some(item => item.prompt.includes(REVIEW_WRITE_FILE)));

  const wrongRead = buildProductionReadinessAudit({
    ...complete,
    ZSSH_REVIEW_FILE: "/srv/zssh-review/alternate.txt",
  });
  assert.equal(wrongRead.ready.reviewer_fixture, false);
  assert.ok(
    wrongRead.lanes.reviewer_fixture.invalid.some(
      item =>
        item.name === "ZSSH_REVIEW_FILE" &&
        item.reason.includes(REVIEW_READ_FILE),
    ),
  );

  const wrongWrite = buildProductionReadinessAudit({
    ...complete,
    ZSSH_REVIEW_WRITE_FILE: "/srv/zssh-review/alternate-output.txt",
  });
  assert.equal(wrongWrite.ready.reviewer_fixture, false);
  assert.ok(
    wrongWrite.lanes.reviewer_fixture.invalid.some(
      item =>
        item.name === "ZSSH_REVIEW_WRITE_FILE" &&
        item.reason.includes(REVIEW_WRITE_FILE),
    ),
  );
});

test("rejects reviewer login evidence from a different OAuth issuer origin", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_REVIEW_LOGIN_URL: "https://review.zssh.dev/login",
    ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://review.zssh.dev/login",
  });

  assert.equal(result.ready.auth0_preflight, true);
  assert.equal(result.ready.reviewer_fixture, false);
  assert.ok(
    result.lanes.reviewer_fixture.invalid.some(
      item =>
        item.name === "ZSSH_REVIEW_LOGIN_URL" &&
        item.reason.includes("same origin as ZSSH_OAUTH_ISSUER"),
    ),
  );
});

test("detects stale reviewer and domain bindings before the final probe", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://tenant.eu.auth0.com/u/old-login",
    ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://old-zssh.cheapgpt.shop",
  });

  assert.equal(result.ready.portal_and_host_attestations, false);
  assert.ok(
    result.lanes.portal_and_host_attestations.invalid.some(
      item =>
        item.name === "ZSSH_REVIEW_LOGIN_VERIFIED_URL" &&
        item.reason.includes("exactly match"),
    ),
  );
  assert.ok(
    result.lanes.portal_and_host_attestations.invalid.some(
      item =>
        item.name === "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN" &&
        item.reason.includes("exact origin"),
    ),
  );
});

test("rejects query and fragment suffixes on verified MCP origin evidence", () => {
  for (const verifiedOrigin of [
    "https://zssh.cheapgpt.shop/?source=portal",
    "https://zssh.cheapgpt.shop/#verified",
  ]) {
    const result = buildProductionReadinessAudit({
      ...complete,
      ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: verifiedOrigin,
    });

    assert.equal(result.ready.portal_and_host_attestations, false);
    assert.ok(
      result.lanes.portal_and_host_attestations.invalid.some(
        item =>
          item.name === "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN" &&
          item.reason.includes("without path, query, or fragment"),
      ),
    );
  }
});

test("never serializes protected values", () => {
  const result = buildProductionReadinessAudit(complete);
  const serialized = JSON.stringify(result);
  for (const protectedValue of [
    complete.CLOUDFLARE_API_TOKEN,
    complete.ZSSH_REVIEW_ACCESS_TOKEN,
    complete.AUTH0_MANAGEMENT_API_TOKEN,
    complete.OPENAI_APPS_CHALLENGE_TOKEN,
  ]) {
    assert.equal(serialized.includes(protectedValue), false);
  }
  assert.equal(result.ready.final_release_config, true);
  assert.deepEqual(result.final_release_config.invalid, []);
  assert.equal(result.execution_state, "ready");
  assert.deepEqual(result.internal_action_gates, []);
  assert.deepEqual(result.external_input_gates, []);
  assert.equal(result.blocking_gate, null);
  assert.equal(result.blocking_action, null);
});

test("protected readiness workflow reclassifies after successful production gates", () => {
  assert.match(
    readinessWorkflow,
    /on:\n  workflow_dispatch:\n  schedule:\n    - cron: "17 \* \* \* \*"\n  workflow_run:\n    workflows:\n      - zSSH production DNS publish\n      - zSSH public ingress external preflight\n      - Auth0 production readiness\n    types:\n      - completed\n  push:\n    branches:\n      - main/,
  );
  assert.match(
    readinessWorkflow,
    /provenance:\n    name: Canonical main provenance\n    if: github\.event_name != 'workflow_run' \|\| \(github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.head_branch == 'main'\)/,
  );
  assert.doesNotMatch(readinessWorkflow, /Bind merged PR event to canonical main SHA/);
  assert.match(
    readinessWorkflow,
    /Require canonical main ref for manual readiness audit[\s\S]*if: github\.event_name == 'workflow_dispatch'[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"/,
  );
  assert.doesNotMatch(
    readinessWorkflow,
    /^  pull_request:/m,
    "readiness convergence must be driven by canonical main state, not closed-PR event timing",
  );
});

test("protected readiness workflow proves merged-PR provenance before entering openai-production", () => {
  assert.match(readinessWorkflow, /permissions:\n  contents: read\n  pull-requests: read/);
  assert.match(
    readinessWorkflow,
    /provenance:[\s\S]*Require candidate SHA to originate from a merged PR[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    readinessWorkflow,
    /Require exact current protected main[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha[\s\S]*main_protected/,
    "readiness provenance must fail closed unless the executing SHA is exact current protected main",
  );
  assert.match(
    readinessWorkflow,
    /PROTECTED="\$\(node -e '[^']+' "\$REPORT_PATH"\)"/,
    "readiness must parse the branch-status receipt without a fragile heredoc",
  );
  assert.doesNotMatch(
    readinessWorkflow,
    /<<\\'NODE\\'/,
    "readiness protection parsing must not regress to the broken quoted heredoc form",
  );
  assert.match(
    readinessWorkflow,
    /audit:\n    name: Classify protected M5 inputs\n    needs: \[provenance, public_origin\][\s\S]*?    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    environment: openai-production/,
  );

  assert.match(
    publicReleaseWorkflow,
    /Require canonical main ref[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"/,
    "final production dispatch must originate from canonical main",
  );
  assert.match(
    publicReleaseWorkflow,
    /Require exact current protected main[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
    "final production provenance must fail closed unless the executing SHA is exact current protected main",
  );

  for (const workflow of [readinessWorkflow, publicReleaseWorkflow]) {
    assert.ok(
      workflow.includes("ZSSH_MAIN_PROTECTION_VERIFIED: ${{ needs.provenance.outputs.governance_verified }}"),
      "protected release workflows must derive governance attestation from live immutable evidence",
    );
    assert.ok(workflow.includes("check-main-protection.mjs --require-negative-proof"));
  }

  const provenanceBlock = readinessWorkflow.match(/  provenance:[\s\S]*?\n  audit:/)?.[0] || "";
  assert.doesNotMatch(
    provenanceBlock,
    /environment:\s*openai-production/,
    "provenance must complete before the protected environment is entered",
  );
});


test("canonical non-secret production defaults stay available without environment-variable provisioning", () => {
  const mcpDefault = "ZSSH_PLUGIN_MCP_URL: ${{ vars.ZSSH_PLUGIN_MCP_URL || 'https://zssh.cheapgpt.shop/mcp' }}";
  const readDefault = "ZSSH_REVIEW_FILE: ${{ vars.ZSSH_REVIEW_FILE || '/srv/zssh-review/sample.txt' }}";
  const writeDefault = "ZSSH_REVIEW_WRITE_FILE: ${{ vars.ZSSH_REVIEW_WRITE_FILE || '/srv/zssh-review/output.txt' }}";

  assert.ok(auth0Workflow.includes(mcpDefault));
  for (const workflow of [readinessWorkflow, publicReleaseWorkflow]) {
    assert.ok(workflow.includes(mcpDefault));
    assert.ok(workflow.includes(readDefault));
    assert.ok(workflow.includes(writeDefault));
  }
});

test("repository governance attestation is derived before protected release environment use", () => {
  assert.ok(readinessWorkflow.includes("governance_verified: ${{ steps.governance-evidence.outputs.verified }}"));
  assert.ok(readinessWorkflow.includes("Verify immutable rejected-direct-write governance evidence"));
  assert.ok(publicReleaseWorkflow.includes("governance_verified: ${{ steps.governance-evidence.outputs.verified }}"));
  assert.ok(publicReleaseWorkflow.includes("Verify immutable rejected-direct-write governance evidence"));
  assert.ok(readinessWorkflow.includes("issues: read"));
  assert.ok(publicReleaseWorkflow.includes("issues: read"));
  assert.equal(readinessWorkflow.includes("ZSSH_MAIN_PROTECTION_VERIFIED: ${{ vars.ZSSH_MAIN_PROTECTION_VERIFIED }}"), false);
  assert.equal(publicReleaseWorkflow.includes("ZSSH_MAIN_PROTECTION_VERIFIED: ${{ vars.ZSSH_MAIN_PROTECTION_VERIFIED }}"), false);
});

test("operator docs do not require the retired mutable governance attestation", () => {
  for (const doc of [releaseChecklist, reviewDoc]) {
    assert.equal(doc.includes("only then set \\`ZSSH_MAIN_PROTECTION_VERIFIED=1\\`"), false);
    assert.equal(doc.includes("# ZSSH_MAIN_PROTECTION_VERIFIED=1"), false);
  }
  assert.ok(releaseChecklist.includes("issue #100"));
  assert.ok(releaseChecklist.includes("No persistent operator-set governance attestation is required."));
  assert.ok(reviewDoc.includes("Repository governance is derived live from protected main + immutable issue #100 negative-proof evidence."));
});


test("readiness workflow carries live public-origin stage into DNS gate classification", () => {
  assert.ok(readinessWorkflow.includes("stage: ${{ steps.observe.outputs.stage }}"));
  assert.ok(readinessWorkflow.includes("id: observe"));
  assert.ok(readinessWorkflow.includes('echo "stage=$STAGE" >> "$GITHUB_OUTPUT"'));
  assert.ok(readinessWorkflow.includes("needs: [provenance, public_origin]"));
  assert.ok(readinessWorkflow.includes("ZSSH_PUBLIC_ORIGIN_STAGE: ${{ needs.public_origin.outputs.stage }}"));
});

test("protected readiness classifier derives Auth0 qualification without widening secret scope", () => {
  assert.match(
    readinessWorkflow,
    /AUTH0_PREFLIGHT_ATTEMPTED=0[\s\S]*AUTH0_PREFLIGHT_VERIFIED=0[\s\S]*check-auth0-production\.mjs[\s\S]*export ZSSH_AUTH0_PREFLIGHT_ATTEMPTED ZSSH_AUTH0_PREFLIGHT_VERIFIED[\s\S]*check-production-readiness-audit\.mjs/,
  );
});

test("readiness workflow limits protected secret references to the classifier step", () => {
  const auditStart = readinessWorkflow.indexOf("  audit:");
  assert.ok(auditStart >= 0, "missing protected readiness audit job");
  const auditBlock = readinessWorkflow.slice(auditStart);
  const auditHeader = auditBlock.split("\n    steps:")[0] || "";
  const classifierTail = auditBlock.split("      - name: Build secret-safe readiness receipt")[1] || "";
  const classifierStep = classifierTail.split("\n      - name:")[0] || "";

  for (const secretName of [
    "CLOUDFLARE_API_TOKEN",
    "ZSSH_REVIEW_ACCESS_TOKEN",
    "AUTH0_MANAGEMENT_API_TOKEN",
    "OPENAI_APPS_CHALLENGE_TOKEN",
  ]) {
    assert.doesNotMatch(
      auditHeader,
      new RegExp(secretName),
      `${secretName} must not be available to every protected readiness step`,
    );
    const secretReference = secretName + ": " + "${{ secrets." + secretName + " }}";
    assert.ok(
      classifierStep.includes(secretReference),
      `${secretName} must be injected only into the secret-safe classifier step`,
    );
  }
});

test("readiness workflow summary exposes gate classification for autonomous consumers", () => {
  assert.ok(readinessWorkflow.includes("Public ingress: ${result.ready.public_ingress ? \"ready\" : \"needs rollout\"}"));
  assert.ok(readinessWorkflow.includes("Execution state: ${result.execution_state}"));
  assert.ok(readinessWorkflow.includes("Blocking gate: ${result.blocking_gate || \"none\"}"));
  assert.ok(readinessWorkflow.includes("Internal action gates: ${result.internal_action_gates.join(\", \") || \"none\"}"));
  assert.ok(readinessWorkflow.includes("External input gates: ${result.external_input_gates.join(\", \") || \"none\"}"));
  assert.ok(readinessWorkflow.includes("Gate kind: ${item.gate_kind}"));
  assert.ok(readinessWorkflow.includes('Requires external input: ${item.requires_external_input ? "yes" : "no"}'));
});


test("protected readiness refreshes hourly for environment-only gate changes", () => {
  assert.match(readinessWorkflow, /schedule:\n    - cron: "17 \* \* \* \*"/);
  assert.match(readinessWorkflow, /provenance:[\s\S]*Require candidate SHA to originate from a merged PR[\s\S]*Require exact current protected main/);
  assert.match(readinessWorkflow, /concurrency:[\s\S]*group: zssh-openai-production-readiness[\s\S]*cancel-in-progress: true/);
});
