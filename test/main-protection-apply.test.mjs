import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRMATION,
  GITHUB_ACTIONS_APP_ID,
  REQUIRED_CHECK_CONTEXT,
  applyMainProtection,
  assessAppliedMainProtection,
  desiredMainProtection,
} from "../scripts/apply-main-protection.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/main-protection-apply.yml", import.meta.url),
  "utf8",
);

function effectiveProtection() {
  return {
    required_status_checks: {
      strict: true,
      contexts: [REQUIRED_CHECK_CONTEXT],
      checks: [
        { context: REQUIRED_CHECK_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID },
      ],
    },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
    },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("canonical desired protection requires PR path and app-bound zSSH CI", () => {
  const desired = desiredMainProtection();
  assert.equal(desired.required_status_checks.strict, true);
  assert.deepEqual(desired.required_status_checks.checks, [
    { context: "test", app_id: 15368 },
  ]);
  assert.equal(desired.enforce_admins, true);
  assert.equal(
    desired.required_pull_request_reviews.required_approving_review_count,
    0,
  );
  assert.equal(desired.required_conversation_resolution, true);
  assert.equal(desired.allow_force_pushes, false);
  assert.equal(desired.allow_deletions, false);
});

test("effective-policy assessment rejects spoofable check, bypass, or unsafe branch controls", () => {
  const protection = effectiveProtection();
  protection.required_status_checks.checks[0].app_id = 999;
  protection.required_pull_request_reviews.bypass_pull_request_allowances.users =
    [{ login: "release-bot" }];
  protection.allow_force_pushes = { enabled: true };

  const result = assessAppliedMainProtection(protection);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.includes("GitHub Actions app")));
  assert.ok(result.issues.some((item) => item.includes("bypass actors")));
  assert.ok(result.issues.some((item) => item.includes("force pushes")));
});

test("apply writes exact main endpoint, re-reads policy, and never claims final attestation", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return response(effectiveProtection());
  };

  const result = await applyMainProtection({
    repository: "Zennay/zSSH",
    branch: "main",
    token: "x".repeat(40),
    confirmation: CONFIRMATION,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.production_attestation_set, false);
  assert.equal(result.negative_direct_push_proof_required, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[1].options.method, "GET");
  assert.match(
    calls[0].url,
    /repos\/Zennay\/zSSH\/branches\/main\/protection$/,
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), desiredMainProtection());
  assert.equal(JSON.stringify(result).includes("x".repeat(40)), false);
});

test("apply refuses wrong repo, weak/missing admin token, and missing confirmation before writes", async () => {
  const never = async () => {
    throw new Error("must not call");
  };

  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/other",
      token: "x".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl: never,
    }),
    /refusing repository/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "short",
      confirmation: CONFIRMATION,
      fetchImpl: never,
    }),
    /ZSSH_REPO_ADMIN_TOKEN/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "x".repeat(40),
      confirmation: "NO",
      fetchImpl: never,
    }),
    /PROTECT_ZSSH_MAIN/,
  );
});

test("admin workflow keeps mutation behind provenance and isolated environment", () => {
  assert.match(workflow, /name: zSSH main protection apply/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /node scripts\/check-main-provenance\.mjs/);
  assert.match(
    workflow,
    /protect:\n    name: Apply and independently verify main protection\n    needs: provenance[\s\S]*environment: repository-governance/,
  );
  assert.match(
    workflow,
    /ZSSH_REPO_ADMIN_TOKEN: \$\{\{ secrets\.ZSSH_REPO_ADMIN_TOKEN \}\}/,
  );
  assert.match(workflow, /node scripts\/apply-main-protection\.mjs --apply/);
  assert.match(
    workflow,
    /node scripts\/check-main-protection\.mjs --public-status --require-protected/,
  );
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.doesNotMatch(workflow, /ZSSH_MAIN_PROTECTION_VERIFIED.*=/);
});
