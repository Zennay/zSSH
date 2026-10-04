#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assessMainProtection } from "./check-main-protection.mjs";

const API_VERSION = "2026-03-10";
export const EXPECTED_REPOSITORY = "Zennay/zSSH";
export const EXPECTED_BRANCH = "main";
export const REQUIRED_STATUS_CHECK = "test";
export const GITHUB_ACTIONS_APP_ID = 15368;
export const CONFIRMATION = "PROTECT_ZSSH_MAIN";

export function desiredMainProtection() {
  return {
    required_status_checks: {
      strict: true,
      checks: [{ context: REQUIRED_STATUS_CHECK, app_id: GITHUB_ACTIONS_APP_ID }],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false,
      bypass_pull_request_allowances: {
        users: [],
        teams: [],
        apps: [],
      },
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

export function assessAppliedMainProtection(protection) {
  const base = assessMainProtection(protection, {
    requiredStatusCheck: REQUIRED_STATUS_CHECK,
  });
  const issues = [...base.issues];
  const checks = Array.isArray(protection?.required_status_checks?.checks)
    ? protection.required_status_checks.checks
    : [];
  const boundCheck = checks.find(
    (check) => check?.context === REQUIRED_STATUS_CHECK,
  );

  if (protection?.required_status_checks?.strict !== true) {
    issues.push("required status checks must be strict");
  }
  if (!boundCheck || Number(boundCheck.app_id) !== GITHUB_ACTIONS_APP_ID) {
    issues.push(
      `required status check "${REQUIRED_STATUS_CHECK}" must be bound to GitHub Actions app ${GITHUB_ACTIONS_APP_ID}`,
    );
  }
  if (!enabled(protection?.required_conversation_resolution)) {
    issues.push("review conversations must be resolved");
  }
  if (enabled(protection?.allow_force_pushes)) {
    issues.push("force pushes must be disabled");
  }
  if (enabled(protection?.allow_deletions)) {
    issues.push("branch deletion must be disabled");
  }

  return {
    ...base,
    ok: issues.length === 0,
    status_checks_strict: protection?.required_status_checks?.strict === true,
    required_status_check_app_id: boundCheck?.app_id ?? null,
    conversations_resolved: enabled(protection?.required_conversation_resolution),
    force_pushes_disabled: !enabled(protection?.allow_force_pushes),
    deletions_disabled: !enabled(protection?.allow_deletions),
    issues,
  };
}

async function githubJson(url, { token, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "zssh-main-protection-applier",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { message: raw.slice(0, 500) };
    }
  }

  if (!response.ok) {
    throw new Error(
      `GitHub branch-protection request failed with HTTP ${response.status}: ${String(parsed?.message || "unknown error")}`,
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
    throw new Error(
      `refusing repository ${repository || "<unset>"}; expected ${EXPECTED_REPOSITORY}`,
    );
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`refusing branch ${branch}; expected ${EXPECTED_BRANCH}`);
  }
  if (!token || token.length < 20) {
    throw new Error(
      "ZSSH_REPO_ADMIN_TOKEN is required and must have repository Administration (write)",
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(
      `ZSSH_MAIN_PROTECTION_CONFIRM must equal ${CONFIRMATION}`,
    );
  }

  const endpoint =
    "https://api.github.com/repos/Zennay/zSSH/branches/main/protection";
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
      `effective main protection is not canonical: ${assessment.issues.join("; ")}`,
    );
  }

  return {
    schema_version: 1,
    ok: true,
    repository,
    branch,
    required_status_check: REQUIRED_STATUS_CHECK,
    required_status_check_app_id: GITHUB_ACTIONS_APP_ID,
    strict_status_checks: true,
    pull_request_required: true,
    approving_reviews_required: 0,
    admins_enforced: true,
    bypass_actors: [],
    conversation_resolution_required: true,
    force_pushes_disabled: true,
    deletions_disabled: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          ok: true,
          mode: "plan",
          repository: EXPECTED_REPOSITORY,
          branch: EXPECTED_BRANCH,
          confirmation: CONFIRMATION,
          protection: desiredMainProtection(),
        },
        null,
        2,
      ),
    );
  } else {
    applyMainProtection()
      .then((result) => {
        console.log("ZSSH_MAIN_PROTECTION_APPLIED", JSON.stringify(result));
      })
      .catch((error) => {
        console.error("ZSSH_MAIN_PROTECTION_APPLY_FAILED", error.message);
        process.exit(1);
      });
  }
}
