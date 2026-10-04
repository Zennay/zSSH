#!/usr/bin/env node
import { readFileSync } from "node:fs";
import process from "node:process";

function fail(message) {
  throw new Error(message);
}

function requireSha256(value, name) {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail(`${name} must be a 64-character lowercase SHA-256 fingerprint`);
  }
  return normalized;
}

export function assertToolScanBinding(attestedFingerprint, liveFingerprint) {
  const attested = requireSha256(attestedFingerprint, "ZSSH_OPENAI_TOOL_SCAN_SHA256");
  const live = requireSha256(liveFingerprint, "live production tool_scan_sha256");
  if (attested !== live) {
    fail("OpenAI portal Scan Tools attestation is stale: configured fingerprint does not match the exact live production tool contract");
  }
  return {
    ok: true,
    openai_tool_scan_sha256: attested,
    tool_scan_sha256: live,
  };
}

export function validateToolScanBindingFromReport(env = process.env) {
  const reportPath = String(env.PROBE_REPORT_PATH || "").trim();
  if (!reportPath) fail("PROBE_REPORT_PATH is required");
  let probe;
  try {
    probe = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    fail(`PROBE_REPORT_PATH must contain valid JSON: ${error.message}`);
  }
  return assertToolScanBinding(env.ZSSH_OPENAI_TOOL_SCAN_SHA256, probe.tool_scan_sha256);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(validateToolScanBindingFromReport(), null, 2));
}
