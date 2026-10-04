import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectMainBranchProtection,
  summarizeBranchProtection,
} from "../scripts/check-main-branch-protection.mjs";

function response(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return json;
    },
  };
}

test("summarizes an unprotected main branch", () => {
  assert.deepEqual(
    summarizeBranchProtection({
      protected: false,
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
      required_status_check_contexts: [],
    },
  );
});

test("summarizes protected branch status checks without duplicates", () => {
  assert.deepEqual(
    summarizeBranchProtection({
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: {
          contexts: ["test"],
          checks: [{ context: "test" }, { context: "repo-hygiene" }],
        },
      },
    }),
    {
      protected: true,
      protection_enabled: true,
      required_status_check_contexts: ["repo-hygiene", "test"],
    },
  );
});

test("inspects the public branch endpoint without serializing the token", async () => {
  const calls = [];
  const result = await inspectMainBranchProtection({
    repository: "Zennay/zSSH",
    branch: "main",
    token: "secret-test-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        name: "main",
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
  assert.equal(result.repository, "Zennay/zSSH");
  assert.equal(result.branch, "main");
  assert.deepEqual(result.required_status_check_contexts, ["test"]);
  assert.equal(JSON.stringify(result).includes("secret-test-token"), false);
  assert.equal(calls[0].url, "https://api.github.com/repos/Zennay/zSSH/branches/main");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-test-token");
});

test("fails closed when the branch lookup is unavailable", async () => {
  await assert.rejects(
    inspectMainBranchProtection({
      repository: "Zennay/zSSH",
      token: "token",
      fetchImpl: async () => response({}, 403),
    }),
    /HTTP 403/,
  );
});
