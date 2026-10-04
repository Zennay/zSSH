#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { verifyMainProtection } from "./check-main-protection.mjs";

const API_VERSION = "2022-11-28";

export function buildMainProtectionRequest({ requiredStatusCheck = "test" } = {}) {
  if (!requiredStatusCheck) {
    throw new Error("requiredStatusCheck must be non-empty");
  }

  return {
    required_status_checks: {
      strict: true,
      contexts: [requiredStatusCheck],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

export async function configureMainProtection({
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
    throw new Error("GITHUB_TOKEN is required to configure branch protection");
  }
  if (!branch) {
    throw new Error("branch must be non-empty");
  }

  const protection = buildMainProtectionRequest({ requiredStatusCheck });
  const endpoint =
    `${apiUrl.replace(/\/$/, "")}/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`;
  const response = await fetchImpl(endpoint, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "zssh-main-protection-configurator",
    },
    body: JSON.stringify(protection),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub branch-protection update failed with HTTP ${response.status}`,
    );
  }

  const verification = await verifyMainProtection({
    repository,
    token,
    branch,
    requiredStatusCheck,
    apiUrl,
    fetchImpl,
  });

  return {
    schema_version: 1,
    ok: verification.ok === true,
    repository,
    branch,
    required_status_check: requiredStatusCheck,
    verified: verification.ok === true,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const repository = process.env.GITHUB_REPOSITORY;
  const branch = process.env.ZSSH_PROTECTED_BRANCH || "main";
  const requiredStatusCheck = process.env.ZSSH_REQUIRED_STATUS_CHECK || "test";
  const plan = buildMainProtectionRequest({ requiredStatusCheck });

  if (!args.has("--apply")) {
    console.log(
      "ZSSH_MAIN_PROTECTION_PLAN",
      JSON.stringify({ repository, branch, protection: plan }),
    );
    return;
  }

  if (process.env.ZSSH_MAIN_PROTECTION_APPLY !== "1") {
    throw new Error(
      "refusing to mutate branch protection without ZSSH_MAIN_PROTECTION_APPLY=1",
    );
  }

  const result = await configureMainProtection({
    repository,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
    branch,
    requiredStatusCheck,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });

  console.log("ZSSH_MAIN_PROTECTION_CONFIGURED", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_CONFIGURE_FAILED", error.message);
    process.exit(1);
  });
}
