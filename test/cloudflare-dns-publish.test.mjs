import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCloudflareDns,
  resolveCloudflareZoneId,
  validateCloudflareZoneId,
  validateCloudflareZoneName,
  validatePublicIpv4,
} from "../scripts/publish-cloudflare-dns.mjs";

const zoneId = "0123456789abcdef0123456789abcdef";
const recordId = "fedcba9876543210fedcba9876543210";

function response(result, { status = 200, success = true, errors = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return { success, result, errors }; },
  };
}

function baseArgs(fetchImpl, overrides = {}) {
  return {
    zoneId,
    apiToken: "test-token-not-secret",
    publicBaseUrl: "https://zssh.cheapgpt.shop",
    ipv4: "198.244.191.182",
    fetchImpl,
    ...overrides,
  };
}

test("validates scoped Cloudflare zone IDs and public IPv4 targets", () => {
  assert.equal(validateCloudflareZoneId(zoneId), zoneId);
  assert.equal(validateCloudflareZoneName("CHEAPGPT.SHOP."), "cheapgpt.shop");
  assert.equal(validatePublicIpv4("198.244.191.182"), "198.244.191.182");
  assert.throws(() => validateCloudflareZoneId("cheapgpt.shop"), /CLOUDFLARE_ZONE_ID/);
  for (const value of ["127.0.0.1", "10.0.0.1", "192.168.1.4", "198.51.100.7", "::1"]) {
    assert.throws(() => validatePublicIpv4(value), /ZSSH_PUBLIC_IPV4/);
  }
});

test("discovers the exact active zone when CLOUDFLARE_ZONE_ID is omitted", async () => {
  const calls = [];
  const result = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      assert.match(calls[0].url, /\/client\/v4\/zones\?/);
      assert.match(calls[0].url, /name=cheapgpt.shop/);
      return response([{ id: zoneId, name: "cheapgpt.shop", status: "active" }]);
    }
    return response([]);
  }, { zoneId: "", zoneName: "cheapgpt.shop" }));
  assert.equal(result.action, "would_create");
  assert.equal(result.zone_source, "discovered");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "GET");
});

test("zone autodiscovery fails closed on missing, duplicate, or unrelated zones", async () => {
  for (const zones of [
    [],
    [{ id: zoneId, name: "cheapgpt.shop", status: "pending" }],
    [
      { id: zoneId, name: "cheapgpt.shop", status: "active" },
      { id: "11111111111111111111111111111111", name: "cheapgpt.shop", status: "active" },
    ],
  ]) {
    await assert.rejects(
      resolveCloudflareZoneId({
        zoneName: "cheapgpt.shop",
        apiToken: "test-token-not-secret",
        hostname: "zssh.cheapgpt.shop",
        fetchImpl: async () => response(zones),
      }),
      /exactly one active cheapgpt\.shop zone/,
    );
  }

  await assert.rejects(
    resolveCloudflareZoneId({
      zoneName: "other.example",
      apiToken: "test-token-not-secret",
      hostname: "zssh.cheapgpt.shop",
      fetchImpl: async () => response([]),
    }),
    /must belong/,
  );
});

test("provider error summaries redact the API token before truncation", async () => {
  for (const apiToken of [
    "cf-secret-reflected-token",
    "cf-" + "s".repeat(220),
  ]) {
    await assert.rejects(
      reconcileCloudflareDns(baseArgs(async () => response(null, {
        status: 403,
        success: false,
        errors: [{ code: 9109, message: `Invalid bearer credential ${apiToken}` }],
      }), { apiToken })),
      error => {
        assert.match(error.message, /9109:/);
        assert.match(error.message, /\[REDACTED\]/);
        assert.equal(error.message.includes(apiToken), false);
        assert.equal(error.message.includes(apiToken.slice(0, 160)), false);
        return true;
      },
    );
  }
});

test("dry-run reports a create without mutating Cloudflare", async () => {
  const calls = [];
  const result = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    return response([]);
  }));
  assert.equal(result.action, "would_create");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
  assert.equal(JSON.stringify(result).includes("test-token-not-secret"), false);
});

test("apply creates the exact DNS-only A record", async () => {
  const calls = [];
  const result = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response([]);
    return response({ id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "198.244.191.182", ttl: 1, proxied: false });
  }, { apply: true }));
  assert.equal(result.action, "created");
  assert.equal(result.ttl, 1);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    type: "A",
    name: "zssh.cheapgpt.shop",
    content: "198.244.191.182",
    ttl: 1,
    proxied: false,
  });
});

test("apply updates one existing A record but preserves unrelated coexisting records", async () => {
  const calls = [];
  const listed = [
    { id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "203.0.113.10", ttl: 300, proxied: true },
    { id: "11111111111111111111111111111111", type: "TXT", name: "zssh.cheapgpt.shop", content: "verification" },
  ];
  const result = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response(listed);
    return response({ id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "198.244.191.182", ttl: 1, proxied: false });
  }, { apply: true, expectedCurrentIpv4: "203.0.113.10" }));
  assert.equal(result.action, "updated");
  assert.equal(result.ttl, 1);
  assert.equal(result.previous_ipv4, "203.0.113.10");
  assert.equal(result.previous_ttl, 300);
  assert.equal(result.previous_proxied, true);
  assert.equal(calls[1].init.method, "PATCH");
  assert.match(calls[1].url, new RegExp(recordId + "$"));
});

test("dry-run exposes an existing A record but requires an explicit update precondition", async () => {
  const result = await reconcileCloudflareDns(baseArgs(async () => response([
    { id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "203.0.113.10", ttl: 300, proxied: true },
  ])));

  assert.equal(result.action, "would_update_requires_precondition");
  assert.equal(result.ttl, 1);
  assert.equal(result.previous_ipv4, "203.0.113.10");
  assert.equal(result.previous_ttl, 300);
  assert.equal(result.previous_proxied, true);
});

test("apply refuses an existing A record without an exact reviewed current-IP precondition", async () => {
  const records = [
    { id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "203.0.113.10", ttl: 300, proxied: true },
  ];

  await assert.rejects(
    reconcileCloudflareDns(baseArgs(async () => response(records), { apply: true })),
    /requires ZSSH_DNS_EXPECTED_CURRENT_IPV4/,
  );
  await assert.rejects(
    reconcileCloudflareDns(baseArgs(async () => response(records), {
      apply: true,
      expectedCurrentIpv4: "203.0.113.11",
    })),
    /changed since the reviewed DNS precondition/,
  );
});

test("TTL drift is not accepted as exact convergence", async () => {
  const stale = [{
    id: recordId,
    type: "A",
    name: "zssh.cheapgpt.shop",
    content: "198.244.191.182",
    ttl: 300,
    proxied: false,
  }];

  const plan = await reconcileCloudflareDns(baseArgs(async () => response(stale)));
  assert.equal(plan.action, "would_update_requires_precondition");
  assert.equal(plan.ttl, 1);
  assert.equal(plan.previous_ttl, 300);

  const calls = [];
  const applied = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response(stale);
    return response({
      id: recordId,
      type: "A",
      name: "zssh.cheapgpt.shop",
      content: "198.244.191.182",
      ttl: 1,
      proxied: false,
    });
  }, {
    apply: true,
    expectedCurrentIpv4: "198.244.191.182",
  }));

  assert.equal(applied.action, "updated");
  assert.equal(applied.ttl, 1);
  assert.equal(applied.previous_ttl, 300);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(JSON.parse(calls[1].init.body).ttl, 1);
});

test("exact record is idempotent and does not write", async () => {
  let calls = 0;
  const result = await reconcileCloudflareDns(baseArgs(async () => {
    calls += 1;
    return response([{ id: recordId, type: "A", name: "zssh.cheapgpt.shop.", content: "198.244.191.182", ttl: 1, proxied: false }]);
  }, { apply: true }));
  assert.equal(result.action, "noop");
  assert.equal(result.ttl, 1);
  assert.equal(calls, 1);
});

test("refuses alternate routing records and multi-A RRsets", async () => {
  for (const records of [
    [{ id: recordId, type: "AAAA", name: "zssh.cheapgpt.shop", content: "2001:4860:4860::8888", ttl: 1, proxied: false }],
    [{ id: recordId, type: "CNAME", name: "zssh.cheapgpt.shop", content: "other.example.net" }],
    [{ id: recordId, type: "HTTPS", name: "zssh.cheapgpt.shop", content: "1 alt.example.net alpn=\"h2\"" }],
    [{ id: recordId, type: "NS", name: "zssh.cheapgpt.shop", content: "ns1.example.net" }],
    [{ id: recordId, type: "SVCB", name: "zssh.cheapgpt.shop", content: "1 alt.example.net alpn=\"h2\"" }],
    [
      { id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "198.244.191.182", ttl: 1, proxied: false },
      { id: "11111111111111111111111111111111", type: "A", name: "zssh.cheapgpt.shop", content: "1.1.1.1", ttl: 1, proxied: false },
    ],
  ]) {
    await assert.rejects(
      reconcileCloudflareDns(baseArgs(async () => response(records), { apply: true })),
      /refusing/,
    );
  }
});


test("autodiscovered zone ID is reused for update writes", async () => {
  const calls = [];
  const listed = [
    { id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "203.0.113.10", ttl: 300, proxied: true },
  ];
  const result = await reconcileCloudflareDns(baseArgs(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return response([{ id: zoneId, name: "cheapgpt.shop", status: "active" }]);
    }
    if (calls.length === 2) return response(listed);
    return response({ id: recordId, type: "A", name: "zssh.cheapgpt.shop", content: "198.244.191.182", ttl: 1, proxied: false });
  }, {
    zoneId: "",
    zoneName: "cheapgpt.shop",
    apply: true,
    expectedCurrentIpv4: "203.0.113.10",
  }));
  assert.equal(result.action, "updated");
  assert.equal(result.zone_source, "discovered");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.method, "PATCH");
  assert.match(calls[2].url, new RegExp(`/zones/${zoneId}/dns_records/${recordId}$`));
});
