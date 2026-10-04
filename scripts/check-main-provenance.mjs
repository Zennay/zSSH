const API_VERSION = "2022-11-28";

export function findMergedPullForSha(pulls, sha) {
  if (!Array.isArray(pulls)) return null;
  return pulls.find((pull) =>
    pull &&
    pull.merged_at &&
    pull.state === "closed" &&
    pull.merge_commit_sha === sha
  ) || null;
}

function assertSha(value, name) {
  if (!/^[a-f0-9]{40}$/i.test(String(value || ""))) {
    throw new Error(`${name} must be a 40-character commit SHA`);
  }
}

const RETRIABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchGitHubJsonWithRetry({
  url,
  token,
  fetchImpl = fetch,
  maxAttempts = 3,
  sleepImpl = defaultSleep,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("maxAttempts must be an integer between 1 and 5");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "zssh-release-provenance",
      },
    });

    if (response.ok) return response.json();

    const retriable = RETRIABLE_HTTP_STATUSES.has(response.status);
    if (!retriable || attempt === maxAttempts) {
      const suffix = retriable ? ` after ${attempt} attempts` : "";
      throw new Error(
        `GitHub commit provenance lookup failed with HTTP ${response.status}${suffix}`
      );
    }

    await sleepImpl(250 * (2 ** (attempt - 1)));
  }

  throw new Error("GitHub commit provenance lookup exhausted unexpectedly");
}

async function fetchJson(url, token, fetchImpl) {
  return fetchGitHubJsonWithRetry({ url, token, fetchImpl });
}

async function mergedPullForCommit({ repository, sha, token, apiUrl, fetchImpl }) {
  const pulls = await fetchJson(
    `${apiUrl}/repos/${repository}/commits/${sha}/pulls`,
    token,
    fetchImpl,
  );
  return findMergedPullForSha(pulls, sha);
}

async function firstParentForCommit({ repository, sha, token, apiUrl, fetchImpl }) {
  const commit = await fetchJson(
    `${apiUrl}/repos/${repository}/commits/${sha}`,
    token,
    fetchImpl,
  );
  const parent = commit?.parents?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/i.test(String(parent || ""))) {
    throw new Error(`commit ${sha} has no valid first parent before provenance baseline`);
  }
  return parent;
}

export async function verifyMainProvenance({
  repository,
  sha,
  token,
  baseSha = "",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
  maxDepth = 200,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  assertSha(sha, "GITHUB_SHA");
  if (baseSha) assertSha(baseSha, "ZSSH_PROVENANCE_BASE_SHA");
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for provenance verification");
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 1000) {
    throw new Error("maxDepth must be an integer between 1 and 1000");
  }

  const normalizedApiUrl = apiUrl.replace(/\/$/, "");
  const verified = [];
  let current = sha;

  while (true) {
    const mergedPull = await mergedPullForCommit({
      repository,
      sha: current,
      token,
      apiUrl: normalizedApiUrl,
      fetchImpl,
    });
    if (!mergedPull) {
      if (!baseSha && current === sha) {
        throw new Error(
          "current main SHA is not the merge_commit_sha of an associated merged pull request"
        );
      }
      throw new Error(
        `first-parent commit ${current} has no merged PR provenance`
      );
    }

    verified.push({
      commit_sha: current,
      pull_request: mergedPull.number,
      pull_request_url: mergedPull.html_url,
      merged_at: mergedPull.merged_at,
    });

    if (!baseSha || current === baseSha) break;
    if (verified.length >= maxDepth) {
      throw new Error(
        `provenance baseline ${baseSha} was not reached within ${maxDepth} first-parent commits`
      );
    }

    current = await firstParentForCommit({
      repository,
      sha: current,
      token,
      apiUrl: normalizedApiUrl,
      fetchImpl,
    });
  }

  const head = verified[0];
  const result = {
    ok: true,
    repository,
    commit_sha: sha,
    pull_request: head.pull_request,
    pull_request_url: head.pull_request_url,
    merged_at: head.merged_at,
  };

  if (baseSha) {
    result.provenance_base_sha = baseSha;
    result.verified_first_parent_commits = verified.length;
    result.first_parent_chain = verified.map(({ commit_sha, pull_request }) => ({
      commit_sha,
      pull_request,
    }));
  }

  return result;
}

async function main() {
  const result = await verifyMainProvenance({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
    baseSha: process.env.ZSSH_PROVENANCE_BASE_SHA || "",
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  console.log("ZSSH_MAIN_PROVENANCE_GREEN", JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("ZSSH_MAIN_PROVENANCE_FAILED", error.message);
    process.exit(1);
  });
}
