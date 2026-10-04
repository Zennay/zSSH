import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMainProtection,
  assertCurrentBranchSha,
  fetchGitHubResponseWithRetry,
  inspectBranchProtectionFlag,
  summarizeBranchMetadata,
  verifyMainProtection,
  verifyMainProtectionNegativeProof,
} from "../scripts/check-main-protection.mjs";

const greenProtection = {
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    bypass_pull_request_allowances: {
      users: [],
      teams: [],
      apps: [],
    },
  },
  required_status_checks: {
    strict: true,
    contexts: ["test"],
    checks: [{ context: "test", app_id: 15368 }],
  },
  enforce_admins: { enabled: true },
};

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

test("retries bounded transient GitHub main-protection API failures", async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchGitHubResponseWithRetry({
    url: "https://api.github.com/repos/Zennay/zSSH/branches/main",
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response(500, {}) : response(200, { ok: true });
    },
    sleepImpl: async (ms) => delays.push(ms),
  });

  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("does not retry non-transient GitHub main-protection API failures", async () => {
  let calls = 0;
  const result = await fetchGitHubResponseWithRetry({
    url: "https://api.github.com/repos/Zennay/zSSH/branches/main",
    fetchImpl: async () => {
      calls += 1;
      return response(403, {});
    },
    sleepImpl: async () => {
      throw new Error("sleep should not run");
    },
  });

  assert.equal(result.status, 403);
  assert.equal(calls, 1);
});

test("stops after bounded retries and lets callers fail closed", async () => {
  let calls = 0;
  const result = await fetchGitHubResponseWithRetry({
    url: "https://api.github.com/repos/Zennay/zSSH/branches/main",
    maxAttempts: 3,
    fetchImpl: async () => {
      calls += 1;
      return response(503, {});
    },
    sleepImpl: async () => {},
  });

  assert.equal(result.status, 503);
  assert.equal(calls, 3);
});

test("accepts protected main with PRs, zSSH CI test check, admins, and no bypass actors", () => {
  const result = assessMainProtection(greenProtection);
  assert.equal(result.ok, true);
  assert.equal(result.required_status_check_present, true);
  assert.equal(result.admins_enforced, true);
  assert.deepEqual(result.bypass_actors, []);
});

test("fails closed when PR enforcement, required check, or admin enforcement is absent", () => {
  const result = assessMainProtection({
    required_pull_request_reviews: null,
    required_status_checks: { contexts: ["other-check"] },
    enforce_admins: { enabled: false },
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /pull-request based changes/);
  assert.match(result.issues.join("\n"), /required status check "test"/);
  assert.match(result.issues.join("\n"), /include administrators/);
});

test("rejects configured pull-request bypass actors", () => {
  const result = assessMainProtection({
    ...greenProtection,
    required_pull_request_reviews: {
      ...greenProtection.required_pull_request_reviews,
      bypass_pull_request_allowances: {
        users: [{ login: "release-bot" }],
        teams: [],
        apps: [],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.bypass_actors, ["users:release-bot"]);
});

test("verifies the GitHub protection endpoint without exposing the token", async () => {
  const calls = [];
  const result = await verifyMainProtection({
    repository: "Zennay/zSSH",
    token: "top-secret-admin-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, greenProtection);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repository, "Zennay/zSSH");
  assert.equal(JSON.stringify(result).includes("top-secret-admin-token"), false);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/Zennay/zSSH/branches/main/protection",
  );
});

test("reports an unprotected branch as a hard failure", async () => {
  await assert.rejects(
    () =>
      verifyMainProtection({
        repository: "Zennay/zSSH",
        token: "token",
        fetchImpl: async () => response(404, {}),
      }),
    /main is not protected/,
  );
});


test("summarizes public branch metadata without claiming admin policy details", () => {
  assert.deepEqual(
    summarizeBranchMetadata({
      protected: false,
      commit: { sha: "a".repeat(40) },
      protection: {
        enabled: false,
        required_status_checks: {
          contexts: [],
          checks: [],
        },
      },
    }),
    {
      protected: false,
      protection_enabled: false,
      commit_sha: "a".repeat(40),
      required_status_check_contexts: [],
    },
  );
});

test("reads the ordinary branch endpoint with the Actions token", async () => {
  const calls = [];
  const result = await inspectBranchProtectionFlag({
    repository: "Zennay/zSSH",
    token: "actions-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, {
        name: "main",
        commit: { sha: "b".repeat(40) },
        protected: true,
        protection: {
          enabled: true,
          required_status_checks: {
            contexts: ["test"],
            checks: [],
          },
        },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.protected, true);
  assert.equal(result.commit_sha, "b".repeat(40));
  assert.equal(result.source, "branch-metadata");
  assert.deepEqual(result.required_status_check_contexts, ["test"]);
  assert.equal(JSON.stringify(result).includes("actions-token"), false);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/Zennay/zSSH/branches/main",
  );
});

test("requires workflow SHA to equal the current protected branch head", () => {
  const current = "c".repeat(40);
  assert.equal(assertCurrentBranchSha(current, current.toUpperCase()), true);
  assert.throws(
    () => assertCurrentBranchSha(current, "d".repeat(40)),
    /not the current protected branch head/,
  );
  assert.throws(
    () => assertCurrentBranchSha("", current),
    /current branch SHA/,
  );
  assert.throws(
    () => assertCurrentBranchSha(current, "not-a-sha"),
    /GITHUB_SHA/,
  );
});

test("public branch status recovers from a transient GitHub API failure", async () => {
  let calls = 0;
  const delays = [];
  const result = await inspectBranchProtectionFlag({
    repository: "Zennay/zSSH",
    token: "token",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response(502, {});
      return response(200, {
        commit: { sha: "e".repeat(40) },
        protected: true,
        protection: { enabled: true, required_status_checks: { contexts: ["test"] } },
      });
    },
  });

  assert.equal(result.protected, true);
  assert.equal(calls, 2);
});

test("public branch status fails closed when metadata is unavailable", async () => {
  await assert.rejects(
    () =>
      inspectBranchProtectionFlag({
        repository: "Zennay/zSSH",
        token: "token",
        fetchImpl: async () => response(403, {}),
      }),
    /HTTP 403/,
  );
});

test("verifies immutable rejected-direct-write evidence against current main ancestry", async () => {
  const canary = "284dadd80a7e46fc9203ed5e5caa9a5709e3f24b";
  const parent = "fa6d8e2f684140043f4e2c41233cb87be804280d";
  const current = "4b72ef9b938306e4c29bc27b47e9cef89ad2e8af";
  const tree = "1".repeat(40);
  const bodies = new Map([
    ["/issues/100", { state: "closed", state_reason: "completed" }],
    ["/issues/100/comments?per_page=100", [{ body: "canary " + canary + " rejected with HTTP 422: Changes must be made through a pull request" }]],
    ["/git/commits/" + canary, { tree: { sha: tree }, parents: [{ sha: parent }] }],
    ["/git/commits/" + parent, { tree: { sha: tree } }],
    ["/branches/main", { protected: true, commit: { sha: current } }],
    ["/compare/" + parent + "..." + current, { status: "ahead" }],
  ]);
  const result = await verifyMainProtectionNegativeProof({
    repository: "Zennay/zSSH",
    token: "actions-token",
    canarySha: canary,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace("/repos/Zennay/zSSH", "") + parsed.search;
      if (!bodies.has(path)) return response(404, {});
      return response(200, bodies.get(path));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.lineage_status, "ahead");
  assert.equal(result.current_main_sha, current);
  assert.equal(JSON.stringify(result).includes("actions-token"), false);
});

test("negative proof fails closed when rejection evidence is stale", async () => {
  const canary = "284dadd80a7e46fc9203ed5e5caa9a5709e3f24b";
  await assert.rejects(
    () => verifyMainProtectionNegativeProof({
      repository: "Zennay/zSSH",
      canarySha: canary,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        const path = parsed.pathname.replace("/repos/Zennay/zSSH", "") + parsed.search;
        if (path === "/issues/100") return response(200, { state: "closed", state_reason: "completed" });
        if (path === "/issues/100/comments?per_page=100") return response(200, [{ body: "missing rejection evidence" }]);
        return response(404, {});
      },
    }),
    /missing required marker/,
  );
});
