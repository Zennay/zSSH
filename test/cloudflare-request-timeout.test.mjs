import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUDFLARE_REQUEST_TIMEOUT_MS,
  reconcileCloudflareDns,
} from "../scripts/publish-cloudflare-dns.mjs";

const zoneId = "a".repeat(32);
const baseInput = Object.freeze({
  zoneId,
  apiToken: "test-cloudflare-token",
  publicBaseUrl: "https://zssh.cheapgpt.shop",
  ipv4: "198.244.191.182",
  apply: false,
});

test("Cloudflare DNS provider requests carry a bounded abort signal", async () => {
  let observedSignal = null;
  const result = await reconcileCloudflareDns({
    ...baseInput,
    fetchImpl: async (_url, init) => {
      observedSignal = init?.signal ?? null;
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, result: [] };
        },
      };
    },
  });

  assert.equal(CLOUDFLARE_REQUEST_TIMEOUT_MS, 10_000);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
  assert.equal(result.action, "would_create");
});

test("Cloudflare DNS provider network failures fail closed without reflecting thrown details", async () => {
  const reflectedSecret = "must-not-leak-provider-secret";
  await assert.rejects(
    () =>
      reconcileCloudflareDns({
        ...baseInput,
        fetchImpl: async () => {
          throw new Error(`socket failure ${reflectedSecret}`);
        },
      }),
    error => {
      assert.match(error.message, /DNS record lookup failed: Cloudflare network request failed/);
      assert.doesNotMatch(error.message, new RegExp(reflectedSecret));
      return true;
    },
  );
});

test("Cloudflare DNS provider aborts use a stable timeout-safe error", async () => {
  await assert.rejects(
    () =>
      reconcileCloudflareDns({
        ...baseInput,
        fetchImpl: async () => {
          const error = new Error("provider call aborted");
          error.name = "TimeoutError";
          throw error;
        },
      }),
    /DNS record lookup failed: Cloudflare request timed out/,
  );
});
