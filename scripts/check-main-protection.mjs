#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";

const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchGitHubResponseWithRetry({
  url,
  options = {},
  fetchImpl = fetch,
  maxAttempts = 3,
  sleepImpl = defaultSleep,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("maxAttempts must be an integer between 1 and 5");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, options);
    if (!RETRIABLE_HTTP_STATUSES.has(response.status) || attempt === maxAttempts) {
      return response;
    }
    await sleepImpl(250 * (2 ** (attempt - 1)));
  }

  throw new Error("GitHub API retry loop exhausted unexpectedly");
}

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

export function assertCurrentBranchSha(branchSha, workflowSha) {
  const normalizedBranchSha = String(branchSha || "").trim();
  const normalizedWorkflowSha = String(workflowSha || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(normalizedBranchSha)) {
    throw new Error("current branch SHA must be a 40-character Git SHA");
  }
  if (!/^[a-f0-9]{40}$/i.test(normalizedWorkflowSha)) {
    throw new Error("GITHUB_SHA must be a 40-character Git SHA");
  }
  if (normalizedBranchSha.toLowerCase() !== normalizedWorkflowSha.toLowerCase()) {
    throw new Error(
      `workflow SHA ${normalizedWorkflowSha} is not the current protected branch head ${normalizedBranchSha}`
    );
  }
  return true;
}

export function summarizeBranchMetadata(branch) {
  const contexts = [
    ...(Array.isArray(branch?.protection?.required_status_checks?.contexts)
      ? branch.protection.required_status_checks.contexts
      : []),
    ...(Array.isArray(branch?.protection?.required_status_checks?.checks)
      ? branch.protection.required_status_checks.checks.map(check => check?.context).filter(Boolean)
      : []),
  ];

  const commitSha = String(branch?.commit?.sha || "").trim();

  return {
    protected: branch?.protected === true,
    protection_enabled: branch?.protection?.enabled === true,
    commit_sha: /^[a-f0-9]{40}$/i.test(commitSha) ? commitSha : null,
    required_status_check_contexts: [...new Set(contexts.map(String))].sort(),
  };
}

export async function inspectBranchProtectionFlag({
  repository,
  token = "",
  branch = "main",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  if (!branch) {
    throw new Error("branch must be non-empty");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "zssh-main-protection-status",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchGitHubResponseWithRetry({
    url: `${apiUrl.replace(/\/$/, "")}/repos/${repository}/branches/${encodeURIComponent(branch)}`,
    options: { headers },
    fetchImpl,
  });
  if (!response.ok) {
    throw new Error(
      `GitHub branch metadata lookup failed with HTTP ${response.status}`,
    );
  }

  const metadata = await response.json();
  return {
    schema_version: 1,
    ok: metadata?.protected === true,
    repository,
    branch,
    source: "branch-metadata",
    ...summarizeBranchMetadata(metadata),
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

  const response = await fetchGitHubResponseWithRetry({
    url: `${apiUrl.replace(/\/$/, "")}/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`,
    options: {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "zssh-main-protection-verifier",
      },
    },
    fetchImpl,
  });

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


export async function verifyMainProtectionNegativeProof({
  repository,
  token = "",
  branch = "main",
  issueNumber = 100,
  canarySha = "284dadd80a7e46fc9203ed5e5caa9a5709e3f24b",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  if (!/^[0-9a-f]{40}$/.test(String(canarySha || ""))) {
    throw new Error("canarySha must be a 40-character Git SHA");
  }

  const root = apiUrl.replace(/\/$/, "");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "zssh-main-protection-negative-proof-verifier",
  };
  if (token) headers.Authorization = "Bearer " + token;

  async function get(path, label) {
    const response = await fetchGitHubResponseWithRetry({
      url: root + "/repos/" + repository + "/" + path,
      options: { headers },
      fetchImpl,
    });
    if (!response.ok) {
      throw new Error(label + " lookup failed with HTTP " + response.status);
    }
    return response.json();
  }

  const issue = await get("issues/" + issueNumber, "governance issue");
  if (issue?.state !== "closed" || issue?.state_reason !== "completed") {
    throw new Error("governance issue #" + issueNumber + " must be closed as completed");
  }

  const comments = await get("issues/" + issueNumber + "/comments?per_page=100", "governance evidence comments");
  const evidenceText = Array.isArray(comments)
    ? comments.map(comment => String(comment?.body || "")).join("\n")
    : "";
  for (const marker of [
    canarySha,
    "HTTP 422",
    "Changes must be made through a pull request",
  ]) {
    if (!evidenceText.includes(marker)) {
      throw new Error("governance evidence is missing required marker: " + marker);
    }
  }

  const canary = await get("git/commits/" + canarySha, "negative-proof canary");
  const parentSha = canary?.parents?.[0]?.sha;
  if (!/^[0-9a-f]{40}$/.test(String(parentSha || ""))) {
    throw new Error("negative-proof canary must have a usable parent");
  }
  const parent = await get("git/commits/" + parentSha, "negative-proof parent");
  if (!canary?.tree?.sha || canary.tree.sha !== parent?.tree?.sha) {
    throw new Error("negative-proof canary must be same-tree as its parent");
  }

  const branchMetadata = await get("branches/" + encodeURIComponent(branch), "current protected branch");
  const currentMainSha = branchMetadata?.commit?.sha;
  if (!/^[0-9a-f]{40}$/.test(String(currentMainSha || ""))) {
    throw new Error("current main SHA is unavailable");
  }
  if (branchMetadata?.protected !== true) {
    throw new Error("branch " + branch + " is not reported as protected by GitHub");
  }

  const comparison = await get("compare/" + parentSha + "..." + currentMainSha, "negative-proof ancestry");
  if (!["ahead", "identical"].includes(comparison?.status)) {
    throw new Error("negative-proof parent is not an ancestor of current " + branch);
  }

  return {
    schema_version: 1,
    ok: true,
    repository,
    branch,
    issue_number: issueNumber,
    canary_sha: canarySha,
    proof_parent_sha: parentSha,
    current_main_sha: currentMainSha,
    lineage_status: comparison.status,
    direct_write_rejection_http_status: 422,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const common = {
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
    branch: process.env.ZSSH_PROTECTED_BRANCH || "main",
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  };

  if (args.has("--require-negative-proof")) {
    const result = await verifyMainProtectionNegativeProof(common);
    console.log("ZSSH_MAIN_PROTECTION_NEGATIVE_PROOF_VERIFIED", JSON.stringify(result));
    return;
  }

  if (args.has("--public-status")) {
    const result = await inspectBranchProtectionFlag(common);
    console.log("ZSSH_MAIN_PROTECTION_STATUS", JSON.stringify(result));
    if (args.has("--require-protected") && !result.protected) {
      throw new Error(`branch ${result.branch} is not reported as protected by GitHub`);
    }
    if (args.has("--require-current-sha")) {
      assertCurrentBranchSha(result.commit_sha, process.env.GITHUB_SHA);
    }
    return;
  }

  const result = await verifyMainProtection({
    ...common,
    requiredStatusCheck: process.env.ZSSH_REQUIRED_STATUS_CHECK || "test",
  });
  console.log("ZSSH_MAIN_PROTECTION_GREEN", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_FAILED", error.message);
    process.exit(1);
  });
}
