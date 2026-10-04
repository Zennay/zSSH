import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMainProtection,
  verifyMainProtection,
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
