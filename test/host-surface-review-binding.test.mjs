import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHostSurfaceReviewBinding,
  computeHostSurfaceReviewFingerprint,
} from "../scripts/check-host-surface-review-binding.mjs";

const mcp = "https://mcp.zssh.dev/mcp";
const toolScan = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const html = "<main>connection-card-v1</main>";

function fingerprint(overrides = {}) {
  return computeHostSurfaceReviewFingerprint({
    mcpUrl: overrides.mcpUrl || mcp,
    toolScanSha256: overrides.toolScanSha256 || toolScan,
    connectionCardHtml: overrides.connectionCardHtml || html,
  }).fingerprint;
}

test("accepts host-surface review bound to exact endpoint, tool contract and UI", () => {
  const result = assertHostSurfaceReviewBinding(mcp, toolScan, fingerprint(), { connectionCardHtml: html });
  assert.equal(result.ok, true);
  assert.equal(result.chatgpt_review_sha256, fingerprint());
});

test("fails closed after MCP endpoint drift", () => {
  assert.throws(
    () => assertHostSurfaceReviewBinding("https://new-mcp.zssh.dev/mcp", toolScan, fingerprint(), { connectionCardHtml: html }),
    /attestation is stale/
  );
});

test("fails closed after tool-contract drift", () => {
  const changed = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  assert.throws(
    () => assertHostSurfaceReviewBinding(mcp, changed, fingerprint(), { connectionCardHtml: html }),
    /attestation is stale/
  );
});

test("fails closed after connection-card UI drift", () => {
  assert.throws(
    () => assertHostSurfaceReviewBinding(mcp, toolScan, fingerprint(), { connectionCardHtml: "<main>connection-card-v2</main>" }),
    /attestation is stale/
  );
});

test("rejects malformed attestation fingerprints", () => {
  assert.throws(
    () => assertHostSurfaceReviewBinding(mcp, toolScan, "not-a-sha", { connectionCardHtml: html }),
    /64-character lowercase SHA-256/
  );
});
