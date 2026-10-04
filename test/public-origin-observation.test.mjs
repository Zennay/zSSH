import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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


test("production readiness runs the public-origin observer without entering the protected environment", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/openai-production-readiness.yml", import.meta.url),
    "utf8",
  );
  const observerBlock = workflow.match(/  public_origin:[\s\S]*?\n  audit:/)?.[0] || "";
  assert.match(observerBlock, /name: Observe public production origin/);
  assert.match(observerBlock, /needs: provenance/);
  assert.match(observerBlock, /node scripts\/observe-public-origin-readiness\.mjs https:\/\/zssh\.cheapgpt\.shop\/mcp/);
  assert.match(observerBlock, /zssh-public-origin-observation-\$\{\{ github\.run_id \}\}/);
  assert.doesNotMatch(observerBlock, /environment:\s*openai-production/);
});


test("scheduled public-origin watch is secretless, read-only, and bounded", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/public-origin-watch.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: "17 \*\/2 \* \* \*"/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /node scripts\/observe-public-origin-readiness\.mjs https:\/\/zssh\.cheapgpt\.shop\/mcp/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /environment:\s*openai-production/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /self-hosted/);
});
