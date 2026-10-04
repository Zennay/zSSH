import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchGitHubJsonWithRetry,
  findMergedPullForSha,
  verifyMainProvenance,
} from "../scripts/check-main-provenance.mjs";

const sha = "67892cfea4b45a9534f49795f6cd3bc06b769f8c";

function response(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  };
}

function mergedPull(commitSha, number) {
  return {
    number,
    state: "closed",
    merged_at: "2026-10-04T00:30:59Z",
    merge_commit_sha: commitSha,
    html_url: `https://github.com/Zennay/zSSH/pull/${number}`,
  };
}

test("selects only a closed merged PR whose merge_commit_sha matches", () => {
  const pulls = [
    { number: 1, state: "closed", merged_at: null, merge_commit_sha: sha },
    { number: 2, state: "open", merged_at: "2026-10-04T00:00:00Z", merge_commit_sha: sha },
    { number: 3, state: "closed", merged_at: "2026-10-04T00:00:00Z", merge_commit_sha: "0".repeat(40) },
    { number: 55, state: "closed", merged_at: "2026-10-04T00:30:59Z", merge_commit_sha: sha },
  ];
  assert.equal(findMergedPullForSha(pulls, sha)?.number, 55);
});

test("fails closed when the current SHA has no merged PR provenance", async () => {
  await assert.rejects(
    () => verifyMainProvenance({
      repository: "Zennay/zSSH",
      sha,
      token: "test-token",
      fetchImpl: async () => response([]),
    }),
    /not the merge_commit_sha/
  );
});

test("emits non-secret evidence when provenance is valid", async () => {
  const result = await verifyMainProvenance({
    repository: "Zennay/zSSH",
    sha,
    token: "test-token",
    fetchImpl: async () => response([mergedPull(sha, 55)]),
  });
  assert.deepEqual(result, {
    ok: true,
    repository: "Zennay/zSSH",
    commit_sha: sha,
    pull_request: 55,
    pull_request_url: "https://github.com/Zennay/zSSH/pull/55",
    merged_at: "2026-10-04T00:30:59Z",
  });
});

test("verifies every first-parent commit through the trusted provenance baseline", async () => {
  const head = "a".repeat(40);
  const middle = "b".repeat(40);
  const base = "c".repeat(40);
  const calls = [];

  const result = await verifyMainProvenance({
    repository: "Zennay/zSSH",
    sha: head,
    baseSha: base,
    token: "test-token",
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith(`/commits/${head}/pulls`)) return response([mergedPull(head, 65)]);
      if (url.endsWith(`/commits/${head}`)) return response({ parents: [{ sha: middle }] });
      if (url.endsWith(`/commits/${middle}/pulls`)) return response([mergedPull(middle, 64)]);
      if (url.endsWith(`/commits/${middle}`)) return response({ parents: [{ sha: base }] });
      if (url.endsWith(`/commits/${base}/pulls`)) return response([mergedPull(base, 61)]);
      throw new Error(`unexpected URL ${url}`);
    },
  });

  assert.equal(result.provenance_base_sha, base);
  assert.equal(result.verified_first_parent_commits, 3);
  assert.deepEqual(result.first_parent_chain, [
    { commit_sha: head, pull_request: 65 },
    { commit_sha: middle, pull_request: 64 },
    { commit_sha: base, pull_request: 61 },
  ]);
  assert.equal(calls.length, 5);
});

test("rejects a direct commit hidden beneath a later merged PR", async () => {
  const head = "d".repeat(40);
  const direct = "e".repeat(40);
  const base = "f".repeat(40);

  await assert.rejects(
    () => verifyMainProvenance({
      repository: "Zennay/zSSH",
      sha: head,
      baseSha: base,
      token: "test-token",
      fetchImpl: async (url) => {
        if (url.endsWith(`/commits/${head}/pulls`)) return response([mergedPull(head, 70)]);
        if (url.endsWith(`/commits/${head}`)) return response({ parents: [{ sha: direct }] });
        if (url.endsWith(`/commits/${direct}/pulls`)) return response([]);
        throw new Error(`unexpected URL ${url}`);
      },
    }),
    new RegExp(`first-parent commit ${direct} has no merged PR provenance`)
  );
});

test("fails closed if the configured provenance baseline is not reached", async () => {
  const head = "1".repeat(40);
  const parent = "2".repeat(40);
  const unreachableBase = "3".repeat(40);

  await assert.rejects(
    () => verifyMainProvenance({
      repository: "Zennay/zSSH",
      sha: head,
      baseSha: unreachableBase,
      token: "test-token",
      maxDepth: 2,
      fetchImpl: async (url) => {
        if (url.endsWith(`/commits/${head}/pulls`)) return response([mergedPull(head, 71)]);
        if (url.endsWith(`/commits/${head}`)) return response({ parents: [{ sha: parent }] });
        if (url.endsWith(`/commits/${parent}/pulls`)) return response([mergedPull(parent, 69)]);
        throw new Error(`unexpected URL ${url}`);
      },
    }),
    /was not reached within 2 first-parent commits/
  );
});


test("retries bounded transient GitHub API failures before succeeding", async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchGitHubJsonWithRetry({
    url: `https://api.github.com/repos/Zennay/zSSH/commits/${sha}/pulls`,
    token: "test-token",
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return response({}, 500);
      return response({ ok: true });
    },
    sleepImpl: async (ms) => delays.push(ms),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("does not retry non-transient GitHub provenance failures", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchGitHubJsonWithRetry({
      url: `https://api.github.com/repos/Zennay/zSSH/commits/${sha}/pulls`,
      token: "test-token",
      fetchImpl: async () => {
        calls += 1;
        return response({}, 404);
      },
      sleepImpl: async () => {
        throw new Error("sleep should not run");
      },
    }),
    /HTTP 404/
  );
  assert.equal(calls, 1);
});

test("fails closed after exhausting transient GitHub provenance retries", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchGitHubJsonWithRetry({
      url: `https://api.github.com/repos/Zennay/zSSH/commits/${sha}/pulls`,
      token: "test-token",
      maxAttempts: 3,
      fetchImpl: async () => {
        calls += 1;
        return response({}, 503);
      },
      sleepImpl: async () => {},
    }),
    /HTTP 503 after 3 attempts/
  );
  assert.equal(calls, 3);
});
