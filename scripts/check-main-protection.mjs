#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";

function listActors(allowances = {}) {
  return ["users", "teams", "apps"].flatMap((kind) =>
    Array.isArray(allowances?.[kind])
      ? allowances[kind].map((actor) => `${kind}:${actor?.login || actor?.slug || actor?.name || "unknown"}`)
      : []
  );
}

export function assessMainProtection(
  protection,
  { requiredStatusCheck = "test" } = {},
) {
  if (!protection || typeof protection !== "object") {
    throw new Error("branch protection payload is required");
  }
  if (!requiredStatusCheck) {
    throw new Error("requiredStatusCheck must be non-empty");
  }

  const pullRequestRule = protection.required_pull_request_reviews;
  const statusRule = protection.required_status_checks;
  const contexts = new Set([
    ...(Array.isArray(statusRule?.contexts) ? statusRule.contexts : []),
    ...(Array.isArray(statusRule?.checks)
      ? statusRule.checks.map((check) => check?.context).filter(Boolean)
      : []),
  ]);
  const bypassActors = listActors(pullRequestRule?.bypass_pull_request_allowances);
  const issues = [];

  if (!pullRequestRule) {
    issues.push("main must require pull-request based changes");
  }
  if (!statusRule) {
    issues.push("main must require status checks");
  } else if (!contexts.has(requiredStatusCheck)) {
    issues.push(`required status check "${requiredStatusCheck}" is not enforced`);
  }
  if (protection.enforce_admins?.enabled !== true) {
    issues.push("branch protection must include administrators");
  }
  if (bypassActors.length > 0) {
    issues.push(`pull-request bypass actors must be empty: ${bypassActors.join(", ")}`);
  }

  return {
    ok: issues.length === 0,
    pr_required: Boolean(pullRequestRule),
    required_status_check: requiredStatusCheck,
    required_status_check_present: contexts.has(requiredStatusCheck),
    admins_enforced: protection.enforce_admins?.enabled === true,
    bypass_actors: bypassActors,
    issues,
  };
}

export async function verifyMainProtection({
  repository,
  token,
  branch = "main",
  requiredStatusCheck = "test",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to verify branch protection");
  }
  if (!branch) {
    throw new Error("branch must be non-empty");
  }

  const response = await fetchImpl(
    `${apiUrl.replace(/\/$/, "")}/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "zssh-main-protection-verifier",
      },
    },
  );

  if (response.status === 404) {
    throw new Error(`branch ${branch} is not protected`);
  }
  if (!response.ok) {
    throw new Error(
      `GitHub branch-protection lookup failed with HTTP ${response.status}`,
    );
  }

  const protection = await response.json();
  const assessment = assessMainProtection(protection, { requiredStatusCheck });
  if (!assessment.ok) {
    throw new Error(assessment.issues.join("; "));
  }

  return {
    schema_version: 1,
    ok: true,
    repository,
    branch,
    ...assessment,
  };
}

async function main() {
  const result = await verifyMainProtection({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    branch: process.env.ZSSH_PROTECTED_BRANCH || "main",
    requiredStatusCheck: process.env.ZSSH_REQUIRED_STATUS_CHECK || "test",
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  console.log("ZSSH_MAIN_PROTECTION_GREEN", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_FAILED", error.message);
    process.exit(1);
  });
}
