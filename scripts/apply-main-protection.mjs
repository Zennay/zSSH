#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assessMainProtection } from "./check-main-protection.mjs";

export const EXPECTED_REPOSITORY = "Zennay/zSSH";
export const EXPECTED_BRANCH = "main";
export const REQUIRED_CHECK_CONTEXT = "test";
export const GITHUB_ACTIONS_APP_ID = 15368;
export const CONFIRMATION = "PROTECT_ZSSH_MAIN";
const API_VERSION = "2022-11-28";

export function desiredMainProtection() {
  return {
    required_status_checks: {
      strict: true,
      checks: [
        {
          context: REQUIRED_CHECK_CONTEXT,
          app_id: GITHUB_ACTIONS_APP_ID,
        },
      ],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false,
    },
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: false,
  };
}

function enabled(value) {
  return value === true || value?.enabled === true;
}

export function assessAppliedMainProtection(protection) {
  const base = assessMainProtection(protection, {
    requiredStatusCheck: REQUIRED_CHECK_CONTEXT,
  });
  const issues = [...base.issues];
  const statusRule = protection?.required_status_checks;
  const checks = Array.isArray(statusRule?.checks) ? statusRule.checks : [];
  const boundCheck = checks.find(
    (check) => check?.context === REQUIRED_CHECK_CONTEXT,
  );

  if (statusRule?.strict !== true) {
    issues.push("required status checks must be strict");
  }
  if (!boundCheck) {
    issues.push(`required check "${REQUIRED_CHECK_CONTEXT}" must use the checks contract`);
  } else if (Number(boundCheck.app_id) !== GITHUB_ACTIONS_APP_ID) {
    issues.push(
      `required check "${REQUIRED_CHECK_CONTEXT}" must be bound to GitHub Actions app ${GITHUB_ACTIONS_APP_ID}`,
    );
  }
  if (!enabled(protection?.required_conversation_resolution)) {
    issues.push("review conversations must be resolved");
  }
  if (enabled(protection?.allow_force_pushes)) {
    issues.push("force pushes must remain disabled");
  }
  if (enabled(protection?.allow_deletions)) {
    issues.push("branch deletion must remain disabled");
  }

  return {
    ...base,
    ok: issues.length === 0,
    strict_status_checks: statusRule?.strict === true,
    required_check_app_id: boundCheck ? Number(boundCheck.app_id) : null,
    conversation_resolution_required:
      enabled(protection?.required_conversation_resolution),
    force_pushes_disabled: !enabled(protection?.allow_force_pushes),
    deletions_disabled: !enabled(protection?.allow_deletions),
    issues,
  };
}

async function githubJson(
  url,
  { token, method = "GET", body, fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "zssh-main-protection-apply",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    throw new Error(
      `GitHub branch-protection request failed with HTTP ${response.status}: ${String(payload?.message || "unknown error")}`,
    );
  }
  return payload;
}

export async function applyMainProtection({
  repository = process.env.GITHUB_REPOSITORY,
  branch = EXPECTED_BRANCH,
  token = process.env.ZSSH_REPO_ADMIN_TOKEN,
  confirmation = process.env.ZSSH_MAIN_PROTECTION_CONFIRM,
  apiUrl = process.env.GITHUB_API_URL || "https://api.github.com",
  fetchImpl = fetch,
} = {}) {
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(
      `refusing repository ${repository || "<unset>"}; expected ${EXPECTED_REPOSITORY}`,
    );
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`refusing branch ${branch}; expected ${EXPECTED_BRANCH}`);
  }
  if (!token || String(token).length < 20) {
    throw new Error(
      "ZSSH_REPO_ADMIN_TOKEN is required and must have repository Administration permission",
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `ZSSH_MAIN_PROTECTION_CONFIRM must equal ${CONFIRMATION}`,
    );
  }

  const endpoint =
    `${String(apiUrl).replace(/\/$/, "")}/repos/${EXPECTED_REPOSITORY}/branches/${EXPECTED_BRANCH}/protection`;

  await githubJson(endpoint, {
    token,
    method: "PUT",
    body: desiredMainProtection(),
    fetchImpl,
  });
  const effective = await githubJson(endpoint, { token, fetchImpl });
  const assessment = assessAppliedMainProtection(effective);
  if (!assessment.ok) {
    throw new Error(
      `applied main protection did not verify: ${assessment.issues.join("; ")}`,
    );
  }

  return {
    schema_version: 1,
    ok: true,
    repository: EXPECTED_REPOSITORY,
    branch: EXPECTED_BRANCH,
    required_check: REQUIRED_CHECK_CONTEXT,
    required_check_app_id: GITHUB_ACTIONS_APP_ID,
    pr_required: assessment.pr_required,
    strict_status_checks: assessment.strict_status_checks,
    admins_enforced: assessment.admins_enforced,
    bypass_actors: assessment.bypass_actors,
    conversation_resolution_required:
      assessment.conversation_resolution_required,
    force_pushes_disabled: assessment.force_pushes_disabled,
    deletions_disabled: assessment.deletions_disabled,
    negative_direct_push_proof_required: true,
    production_attestation_set: false,
  };
}

function plan() {
  return {
    schema_version: 1,
    ok: true,
    mode: "plan",
    repository: EXPECTED_REPOSITORY,
    branch: EXPECTED_BRANCH,
    confirmation: CONFIRMATION,
    required_check: REQUIRED_CHECK_CONTEXT,
    required_check_app_id: GITHUB_ACTIONS_APP_ID,
    protection: desiredMainProtection(),
    production_attestation_set: false,
  };
}

async function main() {
  const result = process.argv.includes("--apply")
    ? await applyMainProtection()
    : plan();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_APPLY_FAILED", error.message);
    process.exit(1);
  });
}
