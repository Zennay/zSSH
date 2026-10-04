import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS,
  cloudflareTokenVerifyUrl,
  verifyCloudflareApiToken,
} from "../scripts/verify-cloudflare-token.mjs";

function response(result, { status = 200, success = true } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return { success, result, errors: [] };
    },
  };
}

test("accepts an active user-owned token without exposing token metadata", async () => {
  const token = "cfut_test_secret_that_must_not_render";
  let request;
  const result = await verifyCloudflareApiToken({
    apiToken: token,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response({
        id: "0123456789abcdef0123456789abcdef",
        status: "active",
        expires_on: "2099-01-01T00:00:00Z",
      });
    },
  });

  assert.deepEqual(result, { ok: true, status: "active" });
  assert.equal(
    request.url,
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  );
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.authorization, `Bearer ${token}`);
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS, 10_000);
  assert.doesNotMatch(JSON.stringify(result), /0123456789abcdef/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
});

test("uses the account-token verification route when an account ID is configured", async () => {
  const accountId = "0123456789abcdef0123456789abcdef";
  let request;
  const result = await verifyCloudflareApiToken({
    apiToken: "cfat_test_secret_that_must_not_render",
    accountId,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response({
        id: "fedcba9876543210fedcba9876543210",
        status: "active",
      });
    },
  });

  assert.deepEqual(result, { ok: true, status: "active" });
  assert.equal(
    request.url,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
  );
});

test("rejects malformed account IDs before contacting Cloudflare", async () => {
  let called = false;
  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      accountId: "not-an-account-id",
      fetchImpl: async () => {
        called = true;
        return response({ status: "active" });
      },
    }),
    /32-character hexadecimal account ID/,
  );
  assert.equal(called, false);
  assert.equal(
    cloudflareTokenVerifyUrl(),
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  );
});

test("rejects disabled, expired, and unknown token status", async () => {
  for (const status of ["disabled", "expired", ""]) {
    await assert.rejects(
      verifyCloudflareApiToken({
        apiToken: "test-token",
        fetchImpl: async () => response({ status }),
      }),
      /not active/,
    );
  }
});

test("fails closed on rejected user-owned tokens without reflecting response details", async () => {
  const reflected = "must-not-leak";
  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() {
          return {
            success: false,
            errors: [{ message: reflected }],
          };
        },
      }),
    }),
    error => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /user-owned API token/);
      assert.match(error.message, /My Profile > API Tokens/);
      assert.doesNotMatch(error.message, new RegExp(reflected));
      return true;
    },
  );
});

test("fails closed on rejected account-owned tokens with account-specific guidance", async () => {
  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      accountId: "0123456789abcdef0123456789abcdef",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() {
          return { success: false, errors: [{ message: "must-not-leak" }] };
        },
      }),
    }),
    error => {
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /account-owned API token/);
      assert.match(error.message, /matching CLOUDFLARE_ACCOUNT_ID/);
      assert.doesNotMatch(error.message, /must-not-leak/);
      return true;
    },
  );
});

test("reports user-token guidance before parsing a rejected provider body", async () => {
  const reflected = "provider-body-must-not-be-parsed";
  let parsed = false;

  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() {
          parsed = true;
          throw new Error(reflected);
        },
      }),
    }),
    error => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /user-owned API token/);
      assert.match(error.message, /My Profile > API Tokens/);
      assert.doesNotMatch(error.message, /invalid JSON/);
      assert.doesNotMatch(error.message, new RegExp(reflected));
      return true;
    },
  );

  assert.equal(parsed, false);
});

test("reports account-token guidance before parsing a rejected provider body", async () => {
  let parsed = false;

  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      accountId: "0123456789abcdef0123456789abcdef",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() {
          parsed = true;
          throw new Error("provider-body-must-not-be-parsed");
        },
      }),
    }),
    error => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /account-owned API token/);
      assert.match(error.message, /matching CLOUDFLARE_ACCOUNT_ID/);
      assert.doesNotMatch(error.message, /invalid JSON/);
      return true;
    },
  );

  assert.equal(parsed, false);
});

test("uses stable timeout-safe errors", async () => {
  await assert.rejects(
    verifyCloudflareApiToken({
      apiToken: "test-token",
      fetchImpl: async () => {
        const error = new Error("secret provider details");
        error.name = "TimeoutError";
        throw error;
      },
    }),
    /request timed out/,
  );
});
