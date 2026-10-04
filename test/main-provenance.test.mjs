import test from "node:test";
import assert from "node:assert/strict";
import { findMergedPullForSha, verifyMainProvenance } from "../scripts/check-main-provenance.mjs";

const sha = "67892cfea4b45a9534f49795f6cd3bc06b769f8c";

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
      fetchImpl: async () => ({
        ok: true,
        json: async () => [],
      }),
    }),
    /not the merge_commit_sha/
  );
});

test("emits non-secret evidence when provenance is valid", async () => {
  const result = await verifyMainProvenance({
    repository: "Zennay/zSSH",
    sha,
    token: "test-token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{
        number: 55,
        state: "closed",
        merged_at: "2026-10-04T00:30:59Z",
        merge_commit_sha: sha,
        html_url: "https://github.com/Zennay/zSSH/pull/55",
      }],
    }),
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
