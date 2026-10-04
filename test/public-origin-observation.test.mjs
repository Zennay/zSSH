import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRODUCTION_MCP_URL,
  classifyPublicIngressFailure,
  observePublicOrigin,
} from "../scripts/observe-public-origin-readiness.mjs";

test("public-origin observer defaults to the selected production MCP URL and preserves strict green evidence", async () => {
  const result = await observePublicOrigin(undefined, {
    checkImpl: async url => ({
      ok: true,
      mcp_url: url,
      endpoint_origin: "https://zssh.cheapgpt.shop",
      dns_address_count: 1,
      dns_families: [4],
      https_health_validated: true,
      unauthenticated_mcp_401_validated: true,
      protected_resource_metadata_validated: true,
    }),
  });

  assert.equal(result.ready, true);
  assert.equal(result.stage, "ready");
  assert.equal(result.mcp_url, DEFAULT_PRODUCTION_MCP_URL);
  assert.equal(result.evidence.ok, true);
});

test("public-origin observer converts expected external not-ready states into non-failing stage evidence", async () => {
  const cases = [
    ["public DNS lookup failed: getaddrinfo ENOTFOUND zssh.cheapgpt.shop", "dns"],
    ["public health endpoint failed: HTTP 502", "https_health"],
    ["unauthenticated public MCP endpoint must return 401, got 200", "mcp_auth"],
    ["OAuth protected-resource metadata failed: HTTP 404", "oauth_metadata"],
    ["fetch failed", "transport"],
  ];

  for (const [message, stage] of cases) {
    const result = await observePublicOrigin(DEFAULT_PRODUCTION_MCP_URL, {
      checkImpl: async () => {
        throw new Error(message);
      },
    });
    assert.equal(result.ready, false);
    assert.equal(result.stage, stage);
    assert.equal(result.reason, message);
  }
});

test("failure classifier keeps malformed endpoint contracts distinct from provider/network readiness", () => {
  assert.equal(
    classifyPublicIngressFailure("ZSSH_PLUGIN_MCP_URL must use the standard HTTPS port"),
    "url_contract",
  );
  assert.equal(classifyPublicIngressFailure("unexpected failure"), "unknown");
});
