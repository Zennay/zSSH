#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";

function assertRepository(value) {
  const repository = String(value || "").trim();
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  return repository;
}

function assertBranch(value) {
  const branch = String(value || "").trim();
  if (!branch || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("branch name is invalid");
  }
  return branch;
}

export function summarizeBranchProtection(branch) {
  const contexts = [
    ...(branch?.protection?.required_status_checks?.contexts || []),
    ...(branch?.protection?.required_status_checks?.checks || []).map(check => check?.context),
  ]
    .filter(Boolean)
    .map(String);

  return {
    protected: branch?.protected === true,
    protection_enabled: branch?.protection?.enabled === true,
    required_status_check_contexts: [...new Set(contexts)].sort(),
  };
}

export async function inspectMainBranchProtection({
  repository,
  branch = "main",
  token = "",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  const repo = assertRepository(repository);
  const branchName = assertBranch(branch);
  const normalizedApiUrl = String(apiUrl || "https://api.github.com").replace(/\/$/, "");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "zssh-main-protection-audit",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(
    `${normalizedApiUrl}/repos/${repo}/branches/${encodeURIComponent(branchName)}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`GitHub branch lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const summary = summarizeBranchProtection(payload);
  return {
    ok: summary.protected,
    repository: repo,
    branch: branchName,
    ...summary,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await inspectMainBranchProtection({
    repository: process.env.GITHUB_REPOSITORY,
    branch: process.env.ZSSH_MAIN_BRANCH || "main",
    token: process.env.GITHUB_TOKEN || "",
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });

  console.log(JSON.stringify(result, null, 2));
  if (args.has("--require-protected") && !result.protected) {
    throw new Error(
      `${result.repository}@${result.branch} is not reported as protected by GitHub`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("ZSSH_MAIN_BRANCH_PROTECTION_FAILED", error.message);
    process.exit(1);
  });
}
