import test from "node:test";
import assert from "node:assert/strict";
import { createFixedWindowRateLimiter, publicRateLimitFromEnv } from "../rate-limit.mjs";

test("public rate-limit config is bounded and defaults to 120 requests per minute", () => {
  assert.deepEqual(publicRateLimitFromEnv({}), {
    limit: 120,
    windowMs: 60_000,
    maxKeys: 10_000,
  });
  assert.equal(publicRateLimitFromEnv({ ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE: "30" }).limit, 30);
  assert.equal(publicRateLimitFromEnv({ ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE: "0" }).limit, 120);
  assert.equal(publicRateLimitFromEnv({ ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE: "999999" }).limit, 120);
});

test("fixed-window limiter isolates opaque profile keys and returns retry timing", () => {
  let current = 1_000;
  const limiter = createFixedWindowRateLimiter({
    limit: 2,
    windowMs: 10_000,
    maxKeys: 100,
    now: () => current,
  });

  assert.deepEqual(limiter.consume("profile-a"), {
    allowed: true,
    capacityLimited: false,
    limit: 2,
    remaining: 1,
    resetAt: 11_000,
    retryAfterSeconds: 0,
  });
  assert.equal(limiter.consume("profile-b").allowed, true);
  assert.equal(limiter.consume("profile-a").remaining, 0);

  const blocked = limiter.consume("profile-a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.capacityLimited, false);
  assert.equal(blocked.retryAfterSeconds, 10);

  current = 11_001;
  const reset = limiter.consume("profile-a");
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 1);
});

test("limiter fails closed for unseen profiles when its bounded key table is full", () => {
  let current = 5_000;
  const limiter = createFixedWindowRateLimiter({
    limit: 10,
    windowMs: 60_000,
    maxKeys: 2,
    now: () => current,
  });

  assert.equal(limiter.consume("profile-a").allowed, true);
  assert.equal(limiter.consume("profile-b").allowed, true);
  const blocked = limiter.consume("profile-c");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.capacityLimited, true);
  assert.equal(limiter.size(), 2);

  current = 65_001;
  assert.equal(limiter.consume("profile-c").allowed, true);
  assert.equal(limiter.size(), 1);
});
