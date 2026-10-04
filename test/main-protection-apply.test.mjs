import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CONFIRMATION,
  GITHUB_ACTIONS_APP_ID,
  applyMainProtection,
  assessAppliedMainProtection,
  desiredMainProtection,
} from "../scripts/apply-main-protection.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/main-protection.yml", import.meta.url),
  "utf8",
);

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalProtection() {
  return {
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
    },
    required_status_checks: {
      strict: true,
      contexts: ["test"],
      checks: [{ context: "test", app_id: GITHUB_ACTIONS_APP_ID }],
    },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

test("desired protection requires the real zSSH CI check without solo-maintainer review deadlock", () => {
  const desired = desiredMainProtection();
  assert.equal(desired.required_status_checks.strict, true);
  assert.deepEqual(desired.required_status_checks.checks, [
    { context: "test", app_id: 15368 },
  ]);
  assert.equal(desired.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(desired.enforce_admins, true);
  assert.equal(desired.allow_force_pushes, false);
  assert.equal(desired.allow_deletions, false);
});

test("effective protection fails closed on spoofable check source or unsafe branch settings", () => {
  const result = assessAppliedMainProtection({
    ...canonicalProtection(),
    required_status_checks: {
      strict: false,
      contexts: ["test"],
      checks: [{ context: "test", app_id: 999 }],
    },
    allow_force_pushes: { enabled: true },
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /strict/);
  assert.match(result.issues.join("\n"), /GitHub Actions app 15368/);
  assert.match(result.issues.join("\n"), /force pushes/);
});

test("apply performs one guarded write then re-reads effective protection", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return response(200, canonicalProtection());
  };

  const result = await applyMainProtection({
    repository: "Zennay/zSSH",
    token: "x".repeat(40),
    confirmation: CONFIRMATION,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.required_status_check_app_id, 15368);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[1].options.method, "GET");
  assert.deepEqual(JSON.parse(calls[0].options.body), desiredMainProtection());
});

test("apply refuses wrong repo, weak credentials, or missing explicit confirmation before mutation", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return response(500, {});
  };

  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/other",
      token: "x".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl,
    }),
    /refusing repository/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "",
      confirmation: CONFIRMATION,
      fetchImpl,
    }),
    /ZSSH_REPO_ADMIN_TOKEN/,
  );
  await assert.rejects(
    applyMainProtection({
      repository: "Zennay/zSSH",
      token: "x".repeat(40),
      confirmation: "NO",
      fetchImpl,
    }),
    /PROTECT_ZSSH_MAIN/,
  );
  assert.equal(called, false);
});

test("admin credential is exposed only after canonical provenance and never with contents write", () => {
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /node scripts\/check-main-provenance\.mjs/);
  assert.match(
    workflow,
    /protect:\n    name: Apply and verify main protection\n    needs: provenance[\s\S]*environment: repository-governance/,
  );
  assert.match(
    workflow,
    /ZSSH_REPO_ADMIN_TOKEN: \$\{\{ secrets\.ZSSH_REPO_ADMIN_TOKEN \}\}/,
  );
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /self-hosted/);
});

test("merged PRs autonomously attempt canonical protection only after provenance", () => {
  assert.match(
    workflow,
    /pull_request:\n    types:\n      - closed\n    branches:\n      - main/,
  );
  assert.match(
    workflow,
    /provenance:\n    name: Require canonical merged-PR provenance\n    if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.merged == true/,
  );
  assert.match(
    workflow,
    /Bind merged PR event to canonical main SHA[\s\S]*MERGED_PR_SHA: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}[\s\S]*test "\$GITHUB_SHA" = "\$MERGED_PR_SHA"/,
  );
  assert.match(
    workflow,
    /ZSSH_MAIN_PROTECTION_CONFIRM: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.confirmation \|\| 'PROTECT_ZSSH_MAIN' \}\}/,
  );
});
