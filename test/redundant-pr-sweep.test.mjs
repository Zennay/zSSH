import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  EXPECTED_BASE_BRANCH,
  EXPECTED_REPOSITORY,
  closeRedundantPullRequests,
} from "../scripts/close-redundant-prs.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/redundant-pr-sweep.yml", import.meta.url),
  "utf8",
);

function response(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("sweep closes only same-repo open PRs with a stable zero-file diff", async () => {
  const calls = [];
  const duplicate = {
    number: 10,
    state: "open",
    base: { ref: "main" },
    head: { sha: "dup-head", repo: { full_name: EXPECTED_REPOSITORY } },
  };
  const changed = {
    number: 11,
    state: "open",
    base: { ref: "main" },
    head: { sha: "real-head", repo: { full_name: EXPECTED_REPOSITORY } },
  };
  const fork = {
    number: 12,
    state: "open",
    base: { ref: "main" },
    head: { sha: "fork-head", repo: { full_name: "someone/fork" } },
  };

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/pulls?state=open")) {
      return response(200, [duplicate, changed, fork]);
    }
    if (url.endsWith("/pulls/10/files?per_page=1")) return response(200, []);
    if (url.endsWith("/pulls/11/files?per_page=1")) {
      return response(200, [{ filename: "server.mjs" }]);
    }
    if (url.endsWith("/pulls/10") && (options.method || "GET") === "GET") {
      return response(200, duplicate);
    }
    if (url.endsWith("/pulls/10") && options.method === "PATCH") {
      assert.deepEqual(JSON.parse(options.body), { state: "closed" });
      return response(200, { ...duplicate, state: "closed" });
    }
    throw new Error(`unexpected request: ${options.method || "GET"} ${url}`);
  };

  const result = await closeRedundantPullRequests({
    repository: EXPECTED_REPOSITORY,
    base: EXPECTED_BASE_BRANCH,
    token: "t".repeat(40),
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scanned, 3);
  assert.equal(result.same_repository_open, 2);
  assert.deepEqual(result.redundant, [10]);
  assert.deepEqual(result.closed, [10]);
  assert.deepEqual(result.skipped_changed_head, []);
  assert.equal(
    calls.filter((call) => call.options.method === "PATCH").length,
    1,
  );
});

test("sweep refuses to close a redundant PR whose head changed during inspection", async () => {
  const listed = {
    number: 20,
    state: "open",
    base: { ref: "main" },
    head: { sha: "old-head", repo: { full_name: EXPECTED_REPOSITORY } },
  };
  let patched = false;
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("/pulls?state=open")) return response(200, [listed]);
    if (url.endsWith("/pulls/20/files?per_page=1")) return response(200, []);
    if (url.endsWith("/pulls/20")) {
      if (options.method === "PATCH") patched = true;
      return response(200, {
        ...listed,
        head: { ...listed.head, sha: "new-head" },
      });
    }
    throw new Error(`unexpected request: ${options.method || "GET"} ${url}`);
  };

  const result = await closeRedundantPullRequests({
    repository: EXPECTED_REPOSITORY,
    token: "t".repeat(40),
    fetchImpl,
  });

  assert.deepEqual(result.closed, []);
  assert.deepEqual(result.skipped_changed_head, [20]);
  assert.equal(patched, false);
});

test("sweep fails closed before mutation for wrong scope or incomplete listing", async () => {
  let calls = 0;
  const never = async () => {
    calls += 1;
    return response(500, {});
  };

  await assert.rejects(
    closeRedundantPullRequests({
      repository: "Zennay/other",
      token: "t".repeat(40),
      fetchImpl: never,
    }),
    /refusing repository/,
  );
  await assert.rejects(
    closeRedundantPullRequests({
      repository: EXPECTED_REPOSITORY,
      base: "release",
      token: "t".repeat(40),
      fetchImpl: never,
    }),
    /refusing base branch/,
  );
  await assert.rejects(
    closeRedundantPullRequests({
      repository: EXPECTED_REPOSITORY,
      token: "",
      fetchImpl: never,
    }),
    /ZSSH_GITHUB_TOKEN/,
  );
  assert.equal(calls, 0);

  const oneHundred = Array.from({ length: 100 }, (_, index) => ({
    number: index + 1,
    state: "open",
    base: { ref: "main" },
    head: {
      sha: `head-${index}`,
      repo: { full_name: EXPECTED_REPOSITORY },
    },
  }));
  await assert.rejects(
    closeRedundantPullRequests({
      repository: EXPECTED_REPOSITORY,
      token: "t".repeat(40),
      fetchImpl: async () => response(200, oneHundred),
    }),
    /incomplete sweep/,
  );
});

test("workflow uses trusted main push and least-privilege PR write access", () => {
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /permissions:\n  contents: read\n  pull-requests: write/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ZSSH_GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /run: node scripts\/close-redundant-prs\.mjs/);
});
