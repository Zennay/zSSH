#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

export const EXPECTED_REPOSITORY = "Zennay/zSSH";
export const EXPECTED_BRANCH = "main";
export const REQUIRED_CHECK_CONTEXT = "test";
export const GITHUB_ACTIONS_APP_ID = 15368;
export const CONFIRMATION = "PROTECT_ZSSH_MAIN";
export const API_VERSION = "2026-03-10";

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
    allow_fork_syncing: true,
  };
}

function enabled(value) {
  return value === true || value?.enabled === true;
}

export function verifyMainProtection(protection) {
  const failures = [];
  const statusChecks = protection?.required_status_checks;
  if (!statusChecks || statusChecks.strict !== true) {
    failures.push("required status checks must be strict");
  }

  const checks = Array.isArray(statusChecks?.checks) ? statusChecks.checks : [];
  const requiredCheck = checks.find(check => check?.context === REQUIRED_CHECK_CONTEXT);
  if (!requiredCheck) {
    failures.push(`required check ${REQUIRED_CHECK_CONTEXT} is missing`);
  } else if (Number(requiredCheck.app_id) !== GITHUB_ACTIONS_APP_ID) {
    failures.push(
      `required check ${REQUIRED_CHECK_CONTEXT} must be bound to GitHub Actions app ${GITHUB_ACTIONS_APP_ID}`,
    );
  }

  if (!enabled(protection?.enforce_admins)) {
    failures.push("administrators must not bypass main protection");
  }

  const reviews = protection?.required_pull_request_reviews;
  if (!reviews) {
    failures.push("pull-request based changes must be required");
  } else if (Number(reviews.required_approving_review_count) !== 0) {
    failures.push("required approving review count must stay at 0 for the solo-maintainer flow");
  }

  if (!enabled(protection?.required_conversation_resolution)) {
    failures.push("review conversations must be resolved");
  }
  if (enabled(protection?.allow_force_pushes)) {
    failures.push("force pushes must stay disabled");
  }
  if (enabled(protection?.allow_deletions)) {
    failures.push("branch deletion must stay disabled");
  }

  if (failures.length > 0) {
    const error = new Error(`main protection verification failed: ${failures.join("; ")}`);
    error.failures = failures;
    throw error;
  }

  return {
    ok: true,
    repository: EXPECTED_REPOSITORY,
    branch: EXPECTED_BRANCH,
    required_check: REQUIRED_CHECK_CONTEXT,
    required_check_app_id: GITHUB_ACTIONS_APP_ID,
    strict_status_checks: true,
    pull_request_required: true,
    approving_reviews_required: 0,
    admin_bypass_disabled: true,
    conversation_resolution_required: true,
    force_pushes_disabled: true,
    deletions_disabled: true,
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
    const message = String(parsed?.message || `HTTP ${response.status}`);
    throw new Error(`GitHub branch-protection request failed (${response.status}): ${message}`);
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
    throw new Error("ZSSH_REPO_ADMIN_TOKEN is required and must be a repository-admin token");
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(`ZSSH_MAIN_PROTECTION_CONFIRM must equal ${CONFIRMATION}`);
  }

  const endpoint =
    "https://api.github.com/repos/Zennay/zSSH/branches/main/protection";
  await githubJson(endpoint, {
    token,
    method: "PUT",
    body: desiredMainProtection(),
    fetchImpl,
  });
  const verified = await githubJson(endpoint, { token, fetchImpl });
  return verifyMainProtection(verified);
}

function plan() {
  return {
    ok: true,
    mode: "plan",
    repository: EXPECTED_REPOSITORY,
    branch: EXPECTED_BRANCH,
    confirmation: CONFIRMATION,
    required_check: REQUIRED_CHECK_CONTEXT,
    required_check_app_id: GITHUB_ACTIONS_APP_ID,
    protection: desiredMainProtection(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  const result = apply ? await applyMainProtection() : plan();
  console.log(JSON.stringify(result, null, 2));
}
