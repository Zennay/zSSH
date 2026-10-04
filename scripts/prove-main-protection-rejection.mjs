#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assessAppliedMainProtection } from "./apply-main-protection.mjs";

export const EXPECTED_REPOSITORY = "Zennay/zSSH";
export const EXPECTED_BRANCH = "main";
export const CONFIRMATION = "PROVE_ZSSH_MAIN_PROTECTION";
const API_VERSION = "2022-11-28";

async function githubRequest(url, { token, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "zssh-main-protection-negative-proof",
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
  return { response, parsed };
}

async function githubJson(url, options) {
  const { response, parsed } = await githubRequest(url, options);
  if (!response.ok) {
    throw new Error(
      `GitHub request failed with HTTP ${response.status}: ${String(parsed?.message || "unknown error")}`,
    );
  }
  return parsed;
}

function rejectionLooksLikePolicy(status, body) {
  if (![403, 409, 422].includes(status)) return false;
  const text = JSON.stringify(body || {}).toLowerCase();
  return /protected branch|pull request|required status|ruleset|repository rule|branch policy|rule violations/.test(text);
}

export async function proveMainProtectionRejectsDirectWrite({
  repository = process.env.GITHUB_REPOSITORY,
  branch = EXPECTED_BRANCH,
  adminToken = process.env.ZSSH_REPO_ADMIN_TOKEN,
  canaryToken = process.env.ZSSH_MAIN_PROTECTION_CANARY_TOKEN,
  confirmation = process.env.ZSSH_MAIN_PROTECTION_PROOF_CONFIRM,
  fetchImpl = fetch,
} = {}) {
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(`refusing repository ${repository || "<unset>"}; expected ${EXPECTED_REPOSITORY}`);
  }
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`refusing branch ${branch}; expected ${EXPECTED_BRANCH}`);
  }
  if (!adminToken || adminToken.length < 20) {
    throw new Error("ZSSH_REPO_ADMIN_TOKEN is required for deep protection verification");
  }
  if (!canaryToken || canaryToken.length < 20) {
    throw new Error("ZSSH_MAIN_PROTECTION_CANARY_TOKEN is required and must have normal contents write access");
  }
  if (adminToken === canaryToken) {
    throw new Error("canary token must be distinct from the repository-admin token");
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(`ZSSH_MAIN_PROTECTION_PROOF_CONFIRM must equal ${CONFIRMATION}`);
  }

  const api = "https://api.github.com/repos/Zennay/zSSH";
  const protection = await githubJson(`${api}/branches/main/protection`, {
    token: adminToken,
    fetchImpl,
  });
  const assessment = assessAppliedMainProtection(protection);
  if (!assessment.ok) {
    throw new Error(`main protection is not canonical: ${assessment.issues.join("; ")}`);
  }

  const branchMetadata = await githubJson(`${api}/branches/main`, {
    token: canaryToken,
    fetchImpl,
  });
  if (branchMetadata?.protected !== true) {
    throw new Error("GitHub does not report main as protected; refusing direct-write proof");
  }
  const currentSha = String(branchMetadata?.commit?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(currentSha)) {
    throw new Error("main branch metadata did not provide a valid 40-character commit SHA");
  }

  const repositoryMetadata = await githubJson(api, {
    token: canaryToken,
    fetchImpl,
  });
  if (repositoryMetadata?.permissions?.push !== true) {
    throw new Error("canary token does not have push permission, so a rejection would not prove branch protection");
  }
  if (repositoryMetadata?.permissions?.admin === true) {
    throw new Error("canary token must be a non-admin normal write path");
  }

  const currentCommit = await githubJson(`${api}/git/commits/${currentSha}`, {
    token: canaryToken,
    fetchImpl,
  });
  const treeSha = String(currentCommit?.tree?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(treeSha)) {
    throw new Error("current main commit did not expose a valid tree SHA");
  }

  const canaryCommit = await githubJson(`${api}/git/commits`, {
    token: canaryToken,
    method: "POST",
    body: {
      message: "zSSH main-protection rejection canary (must not land)",
      tree: treeSha,
      parents: [currentSha],
    },
    fetchImpl,
  });
  const canarySha = String(canaryCommit?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(canarySha)) {
    throw new Error("canary commit creation did not return a valid SHA");
  }

  const { response, parsed } = await githubRequest(`${api}/git/refs/heads/main`, {
    token: canaryToken,
    method: "PATCH",
    body: { sha: canarySha, force: false },
    fetchImpl,
  });

  if (response.ok) {
    throw new Error(
      `CRITICAL: direct main write unexpectedly succeeded to ${canarySha}; release provenance must remain blocked until repaired`,
    );
  }
  if (!rejectionLooksLikePolicy(response.status, parsed)) {
    throw new Error(
      `direct-write attempt failed with HTTP ${response.status}, but the response does not prove branch policy enforcement`,
    );
  }

  return {
    schema_version: 1,
    ok: true,
    repository,
    branch,
    current_sha: currentSha,
    canary_commit_sha: canarySha,
    canary_token_admin: false,
    canary_token_push: true,
    deep_protection_verified: true,
    public_protected_flag: true,
    direct_write_rejected: true,
    rejection_status: response.status,
    rejection_reason: String(parsed?.message || "repository policy rejection").slice(0, 200),
  };
}

async function main() {
  const result = await proveMainProtectionRejectsDirectWrite();
  console.log("ZSSH_MAIN_PROTECTION_NEGATIVE_PROOF", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROTECTION_NEGATIVE_PROOF_FAILED", error.message);
    process.exit(1);
  });
}
