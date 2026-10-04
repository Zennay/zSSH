import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONFIRMATION,
  GITHUB_ACTIONS_APP_ID,
  REQUIRED_CHECK_CONTEXT,
  applyMainProtection,
  desiredMainProtection,
} from "../scripts/apply-main-protection.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/main-protection.yml", import.meta.url),
  "utf8",
);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function protectedState() {
  return {
    required_status_checks: {
      strict: true,
      contexts: [REQUIRED_CHECK_CONTEXT],
      checks: [{ context: REQUIRED_CHECK_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }],
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

test("canonical protection requires PRs and the GitHub Actions test check", () => {
  const desired = desiredMainProtection();
  assert.equal(desired.required_status_checks.strict, true);
  assert.deepEqual(desired.required_status_checks.checks, [
    { context: "test", app_id: 15368 },
  ]);
  assert.equal(desired.enforce_admins, true);
  assert.equal(desired.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(desired.required_conversation_resolution, true);
  assert.equal(desired.allow_force_pushes, false);
  assert.equal(desired.allow_deletions, false);
});

test("apply writes the exact protection endpoint and re-reads it before returning evidence", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return response(protectedState());
  };

  const result = await applyMainProtection({
    repository: "Zennay/zSSH",
    branch: "main",
    token: "x".repeat(40),
    confirmation: CONFIRMATION,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.admins_enforced, true);
  assert.equal(result.required_status_check_present, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[1].options.method, "GET");
  assert.match(calls[0].url, /repos\/Zennay\/zSSH\/branches\/main\/protection$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), desiredMainProtection());
});

test("apply rejects wrong repository, missing token, and missing confirmation before a write", async () => {
  const mustNotCall = async () => {
    throw new Error("must not call");
  };

  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/other",
      token: "x".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl: mustNotCall,
    }),
    /refusing repository/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "",
      confirmation: CONFIRMATION,
      fetchImpl: mustNotCall,
    }),
    /ZSSH_REPO_ADMIN_TOKEN/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "x".repeat(40),
      confirmation: "no",
      fetchImpl: mustNotCall,
    }),
    /PROTECT_ZSSH_MAIN/,
  );
});

test("workflow gates repo-admin credentials behind canonical provenance and a protected environment", () => {
  assert.match(workflow, /name: zSSH main protection/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /node scripts\/check-main-provenance\.mjs/);
  assert.match(
    workflow,
    /protect:\n    name: Apply and verify main protection\n    needs: provenance[\s\S]*environment: repository-governance/,
  );
  assert.match(workflow, /ZSSH_REPO_ADMIN_TOKEN: \$\{\{ secrets\.ZSSH_REPO_ADMIN_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /self-hosted/);
});
