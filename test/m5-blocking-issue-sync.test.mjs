import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderM5BlockingIssue,
  syncM5BlockingIssue,
} from "../scripts/sync-m5-blocking-issue.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/openai-production-readiness.yml", import.meta.url),
  "utf8",
);

const sha = "a".repeat(40);

function receipt(overrides = {}) {
  return {
    schema_version: 4,
    phase: "M5",
    execution_state: "external_input_only",
    blocking_gate: "dns_publication",
    blocking_action: {
      lane: "dns_publication",
      gate_kind: "provider_credentials",
      requires_external_input: true,
      action: "Provision a protected Cloudflare API token scoped only to cheapgpt.shop with Zone Read + DNS Write. For durable CI/CD prefer an account-owned token and set CLOUDFLARE_ACCOUNT_ID; user-owned tokens from My Profile > API Tokens remain supported when CLOUDFLARE_ACCOUNT_ID is unset. The preflight uses /accounts/{account_id}/tokens/verify only for the explicit account path and /user/tokens/verify otherwise. Then trigger the guarded zSSH production DNS publisher through a reviewed change to .github/openai-production-dns-trigger: keep line 1 exactly PUBLISH_ZSSH_PRODUCTION_DNS and add or rotate line 2 as activation-id=<8-80 safe characters>, then merge to protected main. Never place a credential in the marker.",
      missing: ["CLOUDFLARE_API_TOKEN"],
      invalid: [],
    },
    next_actions: [
      { lane: "dns_publication" },
      { lane: "auth0_preflight" },
      { lane: "reviewer_fixture" },
      { lane: "portal_and_host_attestations" },
    ],
    ...overrides,
  };
}

test("renders only secret-safe blocking metadata", () => {
  const readiness = receipt({
    configured: {
      CLOUDFLARE_API_TOKEN: "super-secret-value-that-must-never-render",
    },
  });
  const result = renderM5BlockingIssue({ readiness, canonicalSha: sha });

  assert.equal(result.title, "M5 active gate: dns_publication");
  assert.match(result.body, /CLOUDFLARE_API_TOKEN/);
  assert.match(result.body, /account-owned token/i);
  assert.match(result.body, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(result.body, /user-owned tokens/i);
  assert.match(result.body, /My Profile > API Tokens/);
  assert.match(result.body, /\/accounts\/\{account_id\}\/tokens\/verify/);
  assert.match(result.body, /\/user\/tokens\/verify/);
  assert.match(result.body, /\.github\/openai-production-dns-trigger/);
  assert.match(result.body, /PUBLISH_ZSSH_PRODUCTION_DNS/);
  assert.match(result.body, /activation-id=<8-80 safe characters>/);
  assert.match(result.body, /Never place a credential in the marker/);
  assert.match(result.body, /auth0_preflight/);
  assert.match(result.body, /final_production_probe/);
  assert.match(result.body, /Protected production submission probe/);
  assert.ok(
    result.body.includes(
      `https://github.com/Zennay/zSSH/blob/${sha}/docs/research/auth0-production-oauth-2026-10-04.md`,
    ),
  );
  assert.ok(
    result.body.includes(
      `https://github.com/Zennay/zSSH/blob/${sha}/docs/openai-plugin-review.md`,
    ),
  );
  assert.ok(
    result.body.includes(
      `https://github.com/Zennay/zSSH/blob/${sha}/docs/openai-plugin-release-checklist.md`,
    ),
  );
  assert.match(
    result.body,
    new RegExp(`https://github\\.com/Zennay/zSSH/blob/${sha}/docs/research/cloudflare-dns-publication-2026-10-04\\.md`),
  );
  assert.doesNotMatch(result.body, /super-secret-value-that-must-never-render/);
  assert.match(result.body, new RegExp(sha));
});

test("links later external M5 gates to immutable canonical runbooks", () => {
  const cases = [
    ["public_ingress", "docs/research/public-caddy-promotion-2026-10-04.md"],
    ["auth0_preflight", "docs/research/auth0-production-oauth-2026-10-04.md"],
    ["reviewer_fixture", "docs/openai-plugin-review.md"],
    ["portal_and_host_attestations", "docs/openai-plugin-release-checklist.md"],
  ];

  for (const [gate, path] of cases) {
    const result = renderM5BlockingIssue({
      readiness: receipt({
        blocking_gate: gate,
        blocking_action: {
          lane: gate,
          gate_kind: "external_validation",
          requires_external_input: true,
          action: `Complete ${gate}.`,
          missing: [],
          invalid: [],
        },
        next_actions: [{ lane: gate }],
      }),
      canonicalSha: sha,
    });

    assert.ok(
      result.body.includes(`https://github.com/Zennay/zSSH/blob/${sha}/${path}`),
      `expected immutable runbook link for ${gate}`,
    );
  }
});

test("renders the no-blocker state without inventing a gate", () => {
  const result = renderM5BlockingIssue({
    readiness: receipt({
      execution_state: "ready",
      blocking_gate: null,
      blocking_action: null,
      next_actions: [],
    }),
    canonicalSha: sha,
  });
  assert.equal(result.title, "M5 release handoff: readiness gates green");
  assert.match(result.body, /Blocking gate: none/);
  assert.match(result.body, /Canonical final-submission checklist/);
  assert.match(result.body, /protected OpenAI public release gate/i);
  assert.match(result.body, /OPENAI_PUBLIC_RELEASE_GATE_GREEN/);
  assert.match(result.body, /Only after that succeeds should the portal submission be performed/);
  assert.ok(
    result.body.includes(
      `https://github.com/Zennay/zSSH/blob/${sha}/docs/openai-plugin-release-checklist.md`,
    ),
  );
});

test("rejects mismatched blocking action metadata", () => {
  assert.throws(
    () => renderM5BlockingIssue({
      readiness: receipt({
        blocking_action: {
          lane: "auth0_preflight",
          gate_kind: "provider_configuration",
          requires_external_input: true,
          action: "wrong",
          missing: [],
          invalid: [],
        },
      }),
      canonicalSha: sha,
    }),
    /must match blocking_gate/,
  );
});

test("renders invalid Cloudflare account configuration as a provider-configuration gate", () => {
  const result = renderM5BlockingIssue({
    readiness: receipt({
      blocking_action: {
        lane: "dns_publication",
        gate_kind: "provider_configuration",
        requires_external_input: true,
        action: "Repair the invalid optional Cloudflare configuration before DNS execution.",
        missing: [],
        invalid: [
          {
            name: "CLOUDFLARE_ACCOUNT_ID",
            reason: "must be a 32-character hexadecimal Cloudflare account ID",
          },
        ],
      },
    }),
    canonicalSha: sha,
  });

  assert.match(result.body, /Gate kind: `provider_configuration`/);
  assert.match(
    result.body,
    /\`CLOUDFLARE_ACCOUNT_ID\`: must be a 32-character hexadecimal Cloudflare account ID/,
  );
  assert.doesNotMatch(result.body, /Run the guarded zSSH production DNS publisher/);
});

test("sync uses the token only as an Authorization header", async () => {
  const token = "github-token-secret-value";
  let request;
  const result = await syncM5BlockingIssue({
    repository: "Zennay/zSSH",
    issueNumber: 159,
    token,
    readiness: receipt(),
    canonicalSha: sha,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return {
        ok: true,
        status: 200,
        async json() { return {}; },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.match(request.url, /\/repos\/Zennay\/zSSH\/issues\/159$/);
  assert.equal(request.init.method, "PATCH");
  assert.equal(request.init.headers.authorization, `Bearer ${token}`);
  assert.doesNotMatch(request.init.body, new RegExp(token));
  assert.match(request.init.body, /M5 active gate: dns_publication/);
  assert.match(request.init.body, /Cloudflare production DNS publication/);
});

test("protected readiness audit passes Cloudflare account ID into the M5 classifier", () => {
  const auditJob = workflow.split("\n  audit:\n")[1] || "";
  assert.match(
    auditJob,
    /environment: openai-production[\s\S]*CLOUDFLARE_ZONE_ID: \$\{\{ vars\.CLOUDFLARE_ZONE_ID \}\}[\s\S]*CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}[\s\S]*Build secret-safe readiness receipt/,
  );
});

test("protected readiness audit grants issue write only to the audit job and syncs issue 159", () => {
  assert.match(
    workflow,
    /audit:\n    name: Classify protected M5 inputs[\s\S]*permissions:\n      contents: read\n      issues: write/,
  );
  assert.match(
    workflow,
    /Sync active M5 blocking issue[\s\S]*ZSSH_M5_BLOCKING_ISSUE: "159"[\s\S]*node scripts\/sync-m5-blocking-issue\.mjs "\$READINESS_PATH"/,
  );
});


test("protected readiness audit follows canonical main and successful gate completions", () => {
  assert.match(
    workflow,
    /on:\n  workflow_dispatch:\n  schedule:\n    - cron: "17 \* \* \* \*"\n  workflow_run:\n    workflows:\n      - zSSH production DNS publish\n      - zSSH public ingress external preflight\n      - Auth0 production readiness\n    types:\n      - completed\n  push:\n    branches:\n      - main/,
  );
  assert.doesNotMatch(workflow, /pull_request:\n    types:\n      - closed/);
  assert.match(
    workflow,
    /provenance:[\s\S]*if: github\.event_name != 'workflow_run' \|\| \(github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.head_branch == 'main'\)/,
  );
  assert.doesNotMatch(workflow, /Bind merged PR event to canonical main SHA/);
  assert.match(workflow, /concurrency:[\s\S]*group: zssh-openai-production-readiness[\s\S]*cancel-in-progress: true/);
});
