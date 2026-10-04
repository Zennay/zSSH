import test from "node:test";
import assert from "node:assert/strict";
import { assertToolScanBinding } from "../scripts/check-tool-scan-binding.mjs";

const current = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const stale = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

test("accepts the exact portal-attested production tool fingerprint", () => {
  assert.deepEqual(assertToolScanBinding(current, current), {
    ok: true,
    openai_tool_scan_sha256: current,
    tool_scan_sha256: current,
  });
});

test("fails closed when the live tool contract moved after Scan Tools", () => {
  assert.throws(
    () => assertToolScanBinding(stale, current),
    /attestation is stale/
  );
});

test("rejects malformed fingerprints", () => {
  assert.throws(
    () => assertToolScanBinding("not-a-sha", current),
    /64-character lowercase SHA-256/
  );
  assert.throws(
    () => assertToolScanBinding(current, "BAD"),
    /64-character lowercase SHA-256/
  );
});
