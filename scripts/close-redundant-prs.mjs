#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";
const MAX_OPEN_PULLS = 100;

export const EXPECTED_REPOSITORY = "Zennay/zSSH";
export const EXPECTED_BASE_BRANCH = "main";

function errorMessage(payload) {
  if (payload && typeof payload === "object" && typeof payload.message === "string") {
    return payload.message;
  }
  return "unknown error";
}

async function githubJson(url, { token, method = "GET", body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "zssh-redundant-pr-sweep",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw.slice(0, 500) };
    }
  }

  if (!response.ok) {
    throw new Error(
      `GitHub redundant-PR sweep request failed with HTTP ${response.status}: ${errorMessage(payload)}`,
    );
  }
  return payload;
}

function canonicalSameRepositoryPull(pull, { repository, base }) {
  return (
    Number.isInteger(pull?.number) &&
    pull?.state === "open" &&
    pull?.base?.ref === base &&
    pull?.head?.repo?.full_name === repository &&
    typeof pull?.head?.sha === "string" &&
    pull.head.sha.length >= 7
  );
}

export async function closeRedundantPullRequests({
  repository = process.env.GITHUB_REPOSITORY,
  base = process.env.ZSSH_BASE_BRANCH || EXPECTED_BASE_BRANCH,
  token = process.env.ZSSH_GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(
      `refusing repository ${repository || "<unset>"}; expected ${EXPECTED_REPOSITORY}`,
    );
  }
  if (base !== EXPECTED_BASE_BRANCH) {
    throw new Error(
      `refusing base branch ${base || "<unset>"}; expected ${EXPECTED_BASE_BRANCH}`,
    );
  }
  if (!token || token.length < 20) {
    throw new Error("ZSSH_GITHUB_TOKEN is required");
  }

  const apiRoot = `https://api.github.com/repos/${EXPECTED_REPOSITORY}`;
  const pulls = await githubJson(
    `${apiRoot}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=${MAX_OPEN_PULLS}`,
    { token, fetchImpl },
  );
  if (!Array.isArray(pulls)) {
    throw new Error("GitHub pull list response was not an array");
  }
  if (pulls.length >= MAX_OPEN_PULLS) {
    throw new Error(
      `refusing incomplete sweep: at least ${MAX_OPEN_PULLS} open pull requests target ${base}`,
    );
  }

  const result = {
    schema_version: 1,
    ok: true,
    repository,
    base,
    scanned: pulls.length,
    same_repository_open: 0,
    redundant: [],
    closed: [],
    skipped_changed_head: [],
  };

  for (const listedPull of pulls) {
    if (!canonicalSameRepositoryPull(listedPull, { repository, base })) continue;
    result.same_repository_open += 1;

    const number = listedPull.number;
    const listedHeadSha = listedPull.head.sha;
    const firstFiles = await githubJson(
      `${apiRoot}/pulls/${number}/files?per_page=1`,
      { token, fetchImpl },
    );
    if (!Array.isArray(firstFiles)) {
      throw new Error(`GitHub files response for PR #${number} was not an array`);
    }
    if (firstFiles.length !== 0) continue;

    result.redundant.push(number);

    // Re-read the PR and its effective diff before mutation. This avoids closing a
    // worker branch that received a new commit while the sweep was inspecting it.
    const currentPull = await githubJson(`${apiRoot}/pulls/${number}`, {
      token,
      fetchImpl,
    });
    if (
      !canonicalSameRepositoryPull(currentPull, { repository, base }) ||
      currentPull.head.sha !== listedHeadSha
    ) {
      result.skipped_changed_head.push(number);
      continue;
    }

    const secondFiles = await githubJson(
      `${apiRoot}/pulls/${number}/files?per_page=1`,
      { token, fetchImpl },
    );
    if (!Array.isArray(secondFiles)) {
      throw new Error(`GitHub second files response for PR #${number} was not an array`);
    }
    if (secondFiles.length !== 0) {
      result.skipped_changed_head.push(number);
      continue;
    }

    await githubJson(`${apiRoot}/pulls/${number}`, {
      token,
      method: "PATCH",
      body: { state: "closed" },
      fetchImpl,
    });
    result.closed.push(number);
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  closeRedundantPullRequests()
    .then((result) => {
      console.log("ZSSH_REDUNDANT_PR_SWEEP_GREEN", JSON.stringify(result));
    })
    .catch((error) => {
      console.error("ZSSH_REDUNDANT_PR_SWEEP_FAILED", error.message);
      process.exit(1);
    });
}
