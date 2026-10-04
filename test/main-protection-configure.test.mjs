import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMainProtectionRequest,
  configureMainProtection,
} from "../scripts/configure-main-protection.mjs";

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

const greenProtection = {
  required_pull_request_reviews: {
    required_approving_review_count: 0,
  },
  required_status_checks: {
    strict: true,
    contexts: ["test"],
  },
  enforce_admins: { enabled: true },
};

test("builds the minimal preventive main protection policy", () => {
  assert.deepEqual(buildMainProtectionRequest(), {
    required_status_checks: {
      strict: true,
      contexts: ["test"],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  });
});

test("configures protection then re-reads the live policy", async () => {
  const calls = [];
  const result = await configureMainProtection({
    repository: "Zennay/zSSH",
    token: "admin-secret",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "PUT") {
        return response(200, {});
      }
      return response(200, greenProtection);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PUT");
  assert.match(calls[0].url, /branches\/main\/protection$/);
  assert.equal(
    JSON.parse(calls[0].options.body).required_status_checks.contexts[0],
    "test",
  );
  assert.match(calls[1].url, /branches\/main\/protection$/);
  assert.equal(JSON.stringify(result).includes("admin-secret"), false);
});

test("fails closed when the administrative update is rejected", async () => {
  await assert.rejects(
    () =>
      configureMainProtection({
        repository: "Zennay/zSSH",
        token: "token",
        fetchImpl: async () => response(403),
      }),
    /update failed with HTTP 403/,
  );
});

test("requires an administrative token before any mutation", async () => {
  await assert.rejects(
    () =>
      configureMainProtection({
        repository: "Zennay/zSSH",
        token: "",
        fetchImpl: async () => {
          throw new Error("must not call fetch");
        },
      }),
    /GITHUB_TOKEN is required/,
  );
});
