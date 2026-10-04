import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readinessWorkflow = readFileSync(
  new URL("../.github/workflows/openai-production-readiness.yml", import.meta.url),
  "utf8",
);
const publicReleaseWorkflow = readFileSync(
  new URL("../.github/workflows/public-release-gate.yml", import.meta.url),
  "utf8",
);
import { computeHostSurfaceReviewFingerprint } from "../scripts/check-host-surface-review-binding.mjs";
import { buildProductionReadinessAudit } from "../scripts/check-production-readiness-audit.mjs";

const complete = {
  CLOUDFLARE_ZONE_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_API_TOKEN: "placeholder-cf-value",
  ZSSH_PLUGIN_MCP_URL: "https://zssh.cheapgpt.shop/mcp",
  ZSSH_PLUGIN_DEMO_RECORDING_URL: "https://review.example/zssh-demo",
  ZSSH_REVIEW_ACCESS_TOKEN: "placeholder-review-value",
  ZSSH_REVIEW_LOGIN_URL: "https://tenant.eu.auth0.com/u/login",
  ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://tenant.eu.auth0.com/u/login",
  ZSSH_REVIEW_CREDENTIALS_VERIFIED: "1",
  ZSSH_MAIN_PROTECTION_VERIFIED: "1",
  ZSSH_CHATGPT_DESKTOP_REVIEWED: "1",
  ZSSH_CHATGPT_MOBILE_REVIEWED: "1",
  ZSSH_OPENAI_DOMAIN_VERIFIED: "1",
  ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://zssh.cheapgpt.shop",
  ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "1",
  ZSSH_OPENAI_TOOL_SCAN_SHA256: "b".repeat(64),
  ZSSH_OAUTH_ISSUER: "https://tenant.eu.auth0.com/",
  AUTH0_MANAGEMENT_BASE_URL: "https://tenant.eu.auth0.com",
  AUTH0_MANAGEMENT_API_TOKEN: "placeholder-auth0-value",
  OPENAI_APPS_CHALLENGE_TOKEN: "placeholder-challenge-value",
  ZSSH_REVIEW_FILE: "/srv/zssh-review/sample.txt",
  ZSSH_REVIEW_WRITE_FILE: "/srv/zssh-review/output.txt",
};
complete.ZSSH_CHATGPT_REVIEW_SHA256 = computeHostSurfaceReviewFingerprint({
  mcpUrl: complete.ZSSH_PLUGIN_MCP_URL,
  toolScanSha256: complete.ZSSH_OPENAI_TOOL_SCAN_SHA256,
}).fingerprint;

test("classifies an empty production environment into actionable M5 lanes", () => {
  const result = buildProductionReadinessAudit({});
  assert.equal(result.schema_version, 2);
  assert.equal(result.phase, "M5");
  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, false);
  assert.equal(result.ready.auth0_preflight, false);
  assert.equal(result.ready.final_release_config, false);
  assert.deepEqual(result.lanes.dns_publication.missing, [
    "CLOUDFLARE_ZONE_ID",
    "CLOUDFLARE_API_TOKEN",
  ]);
  assert.deepEqual(result.lanes.dns_publication.invalid, []);
  assert.equal(result.next_actions[0].lane, "repository_governance");
  assert.equal(result.next_actions[1].lane, "dns_publication");
  assert.equal(result.next_actions[2].lane, "auth0_preflight");
});

test("rejects malformed configured values instead of reporting a false-ready lane", () => {
  const result = buildProductionReadinessAudit({
    ...complete,
    ZSSH_MAIN_PROTECTION_VERIFIED: "0",
    CLOUDFLARE_ZONE_ID: "not-a-zone",
    ZSSH_OAUTH_ISSUER: "http://tenant.example.test/",
    AUTH0_MANAGEMENT_API_TOKEN: "short",
    ZSSH_REVIEW_CREDENTIALS_VERIFIED: "0",
  });

  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, false);
  assert.equal(result.ready.auth0_preflight, false);
  assert.equal(result.ready.portal_and_host_attestations, false);

  assert.deepEqual(
    result.lanes.repository_governance.invalid.map(item => item.name),
    ["ZSSH_MAIN_PROTECTION_VERIFIED"],
  );
  assert.deepEqual(
    result.lanes.dns_publication.invalid.map(item => item.name),
    ["CLOUDFLARE_ZONE_ID"],
  );
  assert.deepEqual(
    result.lanes.auth0_preflight.invalid.map(item => item.name),
    ["ZSSH_OAUTH_ISSUER", "AUTH0_MANAGEMENT_API_TOKEN"],
  );
  assert.ok(
    result.lanes.portal_and_host_attestations.invalid.some(
      item => item.name === "ZSSH_REVIEW_CREDENTIALS_VERIFIED",
    ),
  );
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
  });
  assert.equal(result.ready.repository_governance, false);
  assert.equal(result.ready.dns_publication, true);
  assert.equal(result.ready.auth0_preflight, true);
  assert.equal(result.ready.reviewer_fixture, true);
  assert.equal(result.ready.portal_and_host_attestations, true);
  assert.equal(result.ready.final_release_config, false);
  assert.deepEqual(result.next_actions.map(item => item.lane), ["repository_governance"]);
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
});

test("protected readiness workflow runs automatically only for merged PRs and keeps manual dispatch", () => {
  assert.match(
    readinessWorkflow,
    /on:\n  workflow_dispatch:\n  pull_request:\n    types:\n      - closed\n    branches:\n      - main/,
  );
  assert.match(
    readinessWorkflow,
    /provenance:\n    name: Canonical main provenance\n    if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.merged == true/,
  );
  assert.match(
    readinessWorkflow,
    /Bind merged PR event to canonical main SHA[\s\S]*if: github\.event_name == 'pull_request'[\s\S]*MERGED_PR_SHA: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}[\s\S]*test "\$GITHUB_SHA" = "\$MERGED_PR_SHA"/,
  );
  assert.doesNotMatch(
    readinessWorkflow,
    /^  push:/m,
    "protected readiness must not auto-run on direct main pushes while branch protection is absent",
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
    /audit:\n    name: Classify protected M5 inputs\n    needs: provenance\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    environment: openai-production/,
  );

  for (const workflow of [readinessWorkflow, publicReleaseWorkflow]) {
    assert.match(
      workflow,
      /ZSSH_MAIN_PROTECTION_VERIFIED:\s*\$\{\{ vars\.ZSSH_MAIN_PROTECTION_VERIFIED \}\}/,
      "protected release workflows must consume the main-protection attestation",
    );
  }

  const provenanceBlock = readinessWorkflow.match(/  provenance:[\s\S]*?\n  audit:/)?.[0] || "";
  assert.doesNotMatch(
    provenanceBlock,
    /environment:\s*openai-production/,
    "provenance must complete before the protected environment is entered",
  );
});
