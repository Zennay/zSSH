import test from "node:test";
import assert from "node:assert/strict";
import { assertDomainVerificationBinding } from "../scripts/check-domain-verification-binding.mjs";

test("accepts Verify Domain evidence bound to the exact MCP origin", () => {
  assert.deepEqual(
    assertDomainVerificationBinding(
      "https://mcp.zssh.dev/mcp",
      "https://mcp.zssh.dev"
    ),
    {
      ok: true,
      mcp_origin: "https://mcp.zssh.dev",
      verified_mcp_origin: "https://mcp.zssh.dev",
    }
  );
});

test("rejects a stale verification attestation after MCP hostname changes", () => {
  assert.throws(
    () => assertDomainVerificationBinding(
      "https://new-mcp.zssh.dev/mcp",
      "https://mcp.zssh.dev"
    ),
    /stale or for a different endpoint/
  );
});

test("rejects a stale verification attestation after MCP port changes", () => {
  assert.throws(
    () => assertDomainVerificationBinding(
      "https://mcp.zssh.dev:8443/mcp",
      "https://mcp.zssh.dev"
    ),
    /stale or for a different endpoint/
  );
});

test("rejects non-origin, credential-bearing, and non-public attestations", () => {
  assert.throws(
    () => assertDomainVerificationBinding(
      "https://mcp.zssh.dev/mcp",
      "https://mcp.zssh.dev/verified"
    ),
    /only scheme, hostname, and optional port/
  );
  assert.throws(
    () => assertDomainVerificationBinding(
      "https://mcp.zssh.dev/mcp",
      "https://user:pass@mcp.zssh.dev"
    ),
    /without embedded credentials/
  );
  assert.throws(
    () => assertDomainVerificationBinding(
      "https://mcp.zssh.dev/mcp",
      "https://localhost"
    ),
    /public hostname/
  );
});
