function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function publicRateLimitFromEnv(env = process.env) {
  return {
    limit: positiveInteger(env.ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE, 120, { min: 1, max: 6000 }),
    windowMs: 60_000,
    maxKeys: positiveInteger(env.ZSSH_PUBLIC_RATE_LIMIT_MAX_PROFILES, 10_000, { min: 100, max: 100_000 }),
  };
}

export function createFixedWindowRateLimiter({
  limit = 120,
  windowMs = 60_000,
  maxKeys = 10_000,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("rate limit must be a positive integer");
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error("rate limit window must be a positive integer");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("rate limit maxKeys must be a positive integer");

  const buckets = new Map();

  function pruneExpired(current) {
    for (const [key, bucket] of buckets) {
      if (current >= bucket.resetAt) buckets.delete(key);
    }
  }

  function earliestReset(current) {
    let resetAt = current + windowMs;
    for (const bucket of buckets.values()) {
      if (bucket.resetAt < resetAt) resetAt = bucket.resetAt;
    }
    return resetAt;
  }

  return {
    consume(rawKey) {
      const key = String(rawKey || "").trim();
      if (!key) throw new Error("rate limit key is required");

      const current = Number(now());
      if (!Number.isFinite(current)) throw new Error("rate limit clock returned an invalid value");

      let bucket = buckets.get(key);
      if (bucket && current >= bucket.resetAt) {
        buckets.delete(key);
        bucket = null;
      }

      if (!bucket) {
        pruneExpired(current);
        if (buckets.size >= maxKeys) {
          const resetAt = earliestReset(current);
          return {
            allowed: false,
            capacityLimited: true,
            limit,
            remaining: 0,
            resetAt,
            retryAfterSeconds: Math.max(1, Math.ceil((resetAt - current) / 1000)),
          };
        }
        bucket = { count: 0, resetAt: current + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          capacityLimited: false,
          limit,
          remaining: 0,
          resetAt: bucket.resetAt,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
        };
      }

      bucket.count += 1;
      return {
        allowed: true,
        capacityLimited: false,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
        retryAfterSeconds: 0,
      };
    },
    size() {
      return buckets.size;
    },
  };
}
