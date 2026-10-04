import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CONFIRMATION,
  proveMainProtectionRejectsDirectWrite,
} from "../scripts/prove-main-protection-rejection.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/main-protection-negative-proof.yml", import.meta.url),
  "utf8",
);

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalProtection() {
  return {
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
    },
    required_status_checks: {
      strict: true,
      contexts: ["test"],
      checks: [{ context: "test", app_id: 15368 }],
    },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

function fixtureFetch({
  finalStatus = 422,
  finalBody = { message: "Changes must be made through a pull request." },
  admin = false,
} = {}) {
  const currentSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  const canarySha = "c".repeat(40);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/branches/main/protection")) return response(200, canonicalProtection());
    if (url.endsWith("/branches/main")) return response(200, { protected: true, commit: { sha: currentSha } });
    if (url === "https://api.github.com/repos/Zennay/zSSH") {
      return response(200, { permissions: { push: true, admin } });
    }
    if (url.endsWith(`/git/commits/${currentSha}`)) return response(200, { tree: { sha: treeSha } });
    if (url.endsWith("/git/commits") && options.method === "POST") return response(201, { sha: canarySha });
    if (url.endsWith("/git/refs/heads/main") && options.method === "PATCH") return response(finalStatus, finalBody);
    return response(500, { message: "unexpected call" });
  };
  return { fetchImpl, calls, currentSha, canarySha };
}

test("controlled canary proves a write-capable non-admin token is rejected by branch policy", async () => {
  const fixture = fixtureFetch();
  const result = await proveMainProtectionRejectsDirectWrite({
    repository: "Zennay/zSSH",
    adminToken: "a".repeat(40),
    canaryToken: "b".repeat(40),
    confirmation: CONFIRMATION,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.direct_write_rejected, true);
  assert.equal(result.rejection_status, 422);
  assert.equal(result.canary_token_admin, false);
  assert.equal(result.deep_protection_verified, true);
  const patch = fixture.calls.find((call) => call.options.method === "PATCH");
  assert.ok(patch);
  assert.deepEqual(JSON.parse(patch.options.body), { sha: fixture.canarySha, force: false });
});

test("ephemeral Actions canary can prove rejection without an admin secret in the same job", async () => {
  const fixture = fixtureFetch();
  const result = await proveMainProtectionRejectsDirectWrite({
    repository: "Zennay/zSSH",
    adminToken: "",
    canaryToken: "b".repeat(40),
    confirmation: CONFIRMATION,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.deep_protection_verified, false);
  assert.equal(result.public_protected_flag, true);
  assert.equal(result.direct_write_rejected, true);
  assert.equal(
    fixture.calls.some((call) => call.url.endsWith("/branches/main/protection")),
    false,
  );
});

test("generic permission failure is not accepted as branch-protection evidence", async () => {
  const fixture = fixtureFetch({
    finalStatus: 403,
    finalBody: { message: "Resource not accessible by integration" },
  });
  await assert.rejects(
    proveMainProtectionRejectsDirectWrite({
      repository: "Zennay/zSSH",
      adminToken: "",
      canaryToken: "b".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl: fixture.fetchImpl,
    }),
    /does not prove branch policy enforcement/,
  );
});

test("admin canary token is refused before the direct-write attempt", async () => {
  const fixture = fixtureFetch({ admin: true });
  await assert.rejects(
    proveMainProtectionRejectsDirectWrite({
      repository: "Zennay/zSSH",
      adminToken: "",
      canaryToken: "b".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl: fixture.fetchImpl,
    }),
    /non-admin normal write path/,
  );
  assert.equal(fixture.calls.some((call) => call.options.method === "PATCH"), false);
});

test("unexpected successful direct write fails critically rather than producing green evidence", async () => {
  const fixture = fixtureFetch({
    finalStatus: 200,
    finalBody: { ref: "refs/heads/main" },
  });
  await assert.rejects(
    proveMainProtectionRejectsDirectWrite({
      repository: "Zennay/zSSH",
      adminToken: "",
      canaryToken: "b".repeat(40),
      confirmation: CONFIRMATION,
      fetchImpl: fixture.fetchImpl,
    }),
    /CRITICAL: direct main write unexpectedly succeeded/,
  );
});

test("workflow self-boots the proof from canonical main with an ephemeral non-admin Actions token", () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /paths:/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /check-main-provenance\.mjs/);
  assert.match(workflow, /--public-status --require-protected/);
  assert.match(workflow, /environment: repository-governance/);
  assert.match(workflow, /ZSSH_MAIN_PROTECTION_CANARY_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /negative-proof:[\s\S]*permissions:[\s\S]*contents: write/);
  assert.match(workflow, /github\.event_name == 'push'/);
  assert.doesNotMatch(workflow, /secrets\.ZSSH_MAIN_PROTECTION_CANARY_TOKEN/);
  assert.doesNotMatch(workflow, /self-hosted/);
});
