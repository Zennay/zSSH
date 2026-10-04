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
      checks: [{ context: REQUIRED_CHECK_CONTEXT, app_id: GITHUB_ACTIONS_APP_ID }],
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
    allow_fork_syncing: true,
  };
}

async function githubJson(url, { token, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": API_VERSION,
      "content-type": "application/json",
      "user-agent": "zssh-main-protection-applier",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }

  if (!response.ok) {
    throw new Error(
      `GitHub branch-protection request failed (${response.status}): ${parsed?.message || "unknown error"}`,
    );
  }
  return parsed;
}

export async function applyMainProtection({
  repository = process.env.GITHUB_REPOSITORY,
  branch = EXPECTED_BRANCH,
  token = process.env.ZSSH_REPO_ADMIN_TOKEN,
  confirmation = process.env.ZSSH_MAIN_PROTECTION_CONFIRM,
  fetchImpl = fetch,
} = {}) {
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(`refusing repository ${repository || "<unset>"}; expected ${EXPECTED_REPOSITORY}`);
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`refusing branch ${branch}; expected ${EXPECTED_BRANCH}`);
  }
  if (!token || token.length < 20) {
    throw new Error("ZSSH_REPO_ADMIN_TOKEN is required and must have repository Administration write access");
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(`ZSSH_MAIN_PROTECTION_CONFIRM must equal ${CONFIRMATION}`);
  }

  const endpoint = "https://api.github.com/repos/Zennay/zSSH/branches/main/protection";
  await githubJson(endpoint, {
    token,
    method: "PUT",
    body: desiredMainProtection(),
    fetchImpl,
  });

  const effective = await githubJson(endpoint, { token, fetchImpl });
  const assessment = assessMainProtection(effective, {
    requiredStatusCheck: REQUIRED_CHECK_CONTEXT,
  });
  if (!assessment.ok) {
    throw new Error(`applied main protection did not verify: ${assessment.issues.join("; ")}`);
  }

  return {
    schema_version: 1,
    ok: true,
    repository,
    branch,
    required_status_check: REQUIRED_CHECK_CONTEXT,
    required_status_check_app_id: GITHUB_ACTIONS_APP_ID,
    pr_required: assessment.pr_required,
    required_status_check_present: assessment.required_status_check_present,
    admins_enforced: assessment.admins_enforced,
    bypass_actors: assessment.bypass_actors,
    force_pushes_disabled: effective?.allow_force_pushes?.enabled !== true,
    deletions_disabled: effective?.allow_deletions?.enabled !== true,
    conversation_resolution_required:
      effective?.required_conversation_resolution?.enabled === true,
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
    required_status_check: REQUIRED_CHECK_CONTEXT,
    required_status_check_app_id: GITHUB_ACTIONS_APP_ID,
    protection: desiredMainProtection(),
  };
}

async function main() {
  const result = process.argv.includes("--apply") ? await applyMainProtection() : plan();
  console.log("ZSSH_MAIN_PROTECTION_APPLY", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_APPLY_FAILED", error.message);
    process.exit(1);
  });
}
