import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS,
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

test("accepts an active token without exposing token metadata", async () => {
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

test("fails closed on provider rejection without reflecting response details", async () => {
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
      assert.doesNotMatch(error.message, new RegExp(reflected));
      return true;
    },
  );
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
