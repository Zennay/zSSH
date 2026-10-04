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

export async function verifyMainProvenance({
  repository,
  sha,
  token,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) {
    throw new Error("GITHUB_REPOSITORY must be owner/name");
  }
  if (!/^[a-f0-9]{40}$/i.test(String(sha || ""))) {
    throw new Error("GITHUB_SHA must be a 40-character commit SHA");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for provenance verification");
  }

  const url = `${apiUrl.replace(/\/$/, "")}/repos/${repository}/commits/${sha}/pulls`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "zssh-release-provenance",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub commit provenance lookup failed with HTTP ${response.status}`);
  }

  const pulls = await response.json();
  const mergedPull = findMergedPullForSha(pulls, sha);
  if (!mergedPull) {
    throw new Error(
      "current main SHA is not the merge_commit_sha of an associated merged pull request"
    );
  }

  return {
    ok: true,
    repository,
    commit_sha: sha,
    pull_request: mergedPull.number,
    pull_request_url: mergedPull.html_url,
    merged_at: mergedPull.merged_at,
  };
}

async function main() {
  const result = await verifyMainProvenance({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
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
