#!/usr/bin/env node
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { validatePublicMcpUrl } from "../release-contract.mjs";
import { assertDomainVerificationBinding } from "./check-domain-verification-binding.mjs";

const argv = new Set(process.argv.slice(2));

const REQUIRED_RELEASE_CONFIG = [
  "ZSSH_PLUGIN_MCP_URL",
  "ZSSH_PLUGIN_DEMO_RECORDING_URL",
  "ZSSH_REVIEW_ACCESS_TOKEN",
  "ZSSH_REVIEW_LOGIN_URL",
  "ZSSH_REVIEW_CREDENTIALS_VERIFIED",
  "ZSSH_CHATGPT_DESKTOP_REVIEWED",
  "ZSSH_CHATGPT_MOBILE_REVIEWED",
  "ZSSH_OPENAI_DOMAIN_VERIFIED",
  "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN",
  "ZSSH_OPENAI_TOOL_SCAN_VERIFIED",
  "ZSSH_OPENAI_TOOL_SCAN_SHA256",
  "OPENAI_APPS_CHALLENGE_TOKEN",
  "ZSSH_REVIEW_FILE",
  "ZSSH_REVIEW_WRITE_FILE",
];

export function publicReleaseConfigPresence(env = process.env) {
  const configured = Object.fromEntries(
    REQUIRED_RELEASE_CONFIG.map(name => [name, String(env[name] || "").trim().length > 0])
  );
  const missing = REQUIRED_RELEASE_CONFIG.filter(name => !configured[name]);
  return {
    ok: missing.length === 0,
    configured,
    missing,
  };
}

function fail(message) {
  throw new Error(message);
}

function requireValue(env, name, { minLength = 1 } = {}) {
  const value = String(env[name] || "").trim();
  if (value.length < minLength) fail(`${name} is required and must be at least ${minLength} characters`);
  return value;
}

function requireHttpsUrl(env, name) {
  let url;
  try {
    url = new URL(requireValue(env, name));
  } catch {
    fail(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail(`${name} must be an HTTPS URL without embedded credentials`);
  }
  return url;
}

function requirePublicHttpsUrl(env, name) {
  const url = requireHttpsUrl(env, name);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    net.isIP(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    fail(`${name} must use a public DNS hostname reachable by OpenAI reviewers`);
  }
  return url;
}

export function validatePublicReleaseConfig(env = process.env) {
  const mcpUrl = validatePublicMcpUrl(
    requireValue(env, "ZSSH_PLUGIN_MCP_URL"),
    { name: "ZSSH_PLUGIN_MCP_URL" }
  );
  const demoRecordingUrl = requireHttpsUrl(env, "ZSSH_PLUGIN_DEMO_RECORDING_URL");
  const accessToken = requireValue(env, "ZSSH_REVIEW_ACCESS_TOKEN", { minLength: 20 });
  const reviewLoginUrl = requirePublicHttpsUrl(env, "ZSSH_REVIEW_LOGIN_URL");
  const reviewCredentialsVerified = requireValue(env, "ZSSH_REVIEW_CREDENTIALS_VERIFIED");
  if (reviewCredentialsVerified !== "1") {
    fail("ZSSH_REVIEW_CREDENTIALS_VERIFIED must be exactly 1 after the dedicated reviewer login has been tested without MFA, email/SMS confirmation, magic links, or private-network access");
  }
  const chatgptDesktopReviewed = requireValue(env, "ZSSH_CHATGPT_DESKTOP_REVIEWED");
  if (chatgptDesktopReviewed !== "1") {
    fail("ZSSH_CHATGPT_DESKTOP_REVIEWED must be exactly 1 only after the production connection card has been exercised successfully in ChatGPT desktop");
  }
  const chatgptMobileReviewed = requireValue(env, "ZSSH_CHATGPT_MOBILE_REVIEWED");
  if (chatgptMobileReviewed !== "1") {
    fail("ZSSH_CHATGPT_MOBILE_REVIEWED must be exactly 1 only after the production connection card has been exercised successfully in ChatGPT mobile");
  }
  const openaiDomainVerified = requireValue(env, "ZSSH_OPENAI_DOMAIN_VERIFIED");
  if (openaiDomainVerified !== "1") {
    fail("ZSSH_OPENAI_DOMAIN_VERIFIED must be exactly 1 only after Verify Domain has passed in the OpenAI plugin submission portal");
  }
  const domainBinding = assertDomainVerificationBinding(
    mcpUrl.href,
    requireValue(env, "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN")
  );
  const openaiToolScanVerified = requireValue(env, "ZSSH_OPENAI_TOOL_SCAN_VERIFIED");
  if (openaiToolScanVerified !== "1") {
    fail("ZSSH_OPENAI_TOOL_SCAN_VERIFIED must be exactly 1 only after Scan Tools has completed successfully against the current production MCP server");
  }
  const openaiToolScanSha256 = requireValue(env, "ZSSH_OPENAI_TOOL_SCAN_SHA256");
  if (!/^[a-f0-9]{64}$/.test(openaiToolScanSha256)) {
    fail("ZSSH_OPENAI_TOOL_SCAN_SHA256 must be the 64-character lowercase SHA-256 fingerprint from the exact production tool contract that was scanned in the OpenAI portal");
  }
  const challengeToken = requireValue(env, "OPENAI_APPS_CHALLENGE_TOKEN", { minLength: 16 });
  const reviewFile = requireValue(env, "ZSSH_REVIEW_FILE");
  const writeFile = requireValue(env, "ZSSH_REVIEW_WRITE_FILE");

  if (!path.isAbsolute(reviewFile) || !path.isAbsolute(writeFile)) {
    fail("ZSSH_REVIEW_FILE and ZSSH_REVIEW_WRITE_FILE must be absolute paths");
  }
  if (path.normalize(reviewFile) === path.normalize(writeFile)) {
    fail("ZSSH_REVIEW_FILE and ZSSH_REVIEW_WRITE_FILE must be different files");
  }

  return {
    ok: true,
    endpoint_origin: mcpUrl.origin,
    endpoint_path: mcpUrl.pathname,
    demo_recording_origin: demoRecordingUrl.origin,
    review_login_origin: reviewLoginUrl.origin,
    review_login_path: reviewLoginUrl.pathname,
    review_credentials_verified: true,
    chatgpt_desktop_reviewed: true,
    chatgpt_mobile_reviewed: true,
    openai_domain_verified: true,
    verified_mcp_origin: domainBinding.verified_mcp_origin,
    openai_tool_scan_verified: true,
    openai_tool_scan_sha256: openaiToolScanSha256,
    review_file_name: path.basename(reviewFile),
    write_file_name: path.basename(writeFile),
    access_token_present: accessToken.length > 0,
    challenge_token_present: challengeToken.length > 0
  };
}

function assertThrows(fn, pattern) {
  let error;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  if (!error) fail("self-test expected validation to fail");
  if (pattern && !pattern.test(String(error.message))) {
    fail(`self-test error did not match ${pattern}: ${error.message}`);
  }
}

export function runSelfTest() {
  const good = {
    ZSSH_PLUGIN_MCP_URL: "https://mcp.zssh.dev/mcp",
    ZSSH_PLUGIN_DEMO_RECORDING_URL: "https://review.example/zssh-demo",
    ZSSH_REVIEW_ACCESS_TOKEN: "review-token-0123456789abcdef",
    ZSSH_REVIEW_LOGIN_URL: "https://auth.zssh.dev/login",
    ZSSH_REVIEW_CREDENTIALS_VERIFIED: "1",
    ZSSH_CHATGPT_DESKTOP_REVIEWED: "1",
    ZSSH_CHATGPT_MOBILE_REVIEWED: "1",
    ZSSH_OPENAI_DOMAIN_VERIFIED: "1",
    ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://mcp.zssh.dev",
    ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "1",
    ZSSH_OPENAI_TOOL_SCAN_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    OPENAI_APPS_CHALLENGE_TOKEN: "challenge-0123456789abcdef",
    ZSSH_REVIEW_FILE: "/srv/zssh-review/sample.txt",
    ZSSH_REVIEW_WRITE_FILE: "/srv/zssh-review/output.txt"
  };
  const result = validatePublicReleaseConfig(good);
  if (!result.ok || result.endpoint_path !== "/mcp") fail("self-test valid configuration failed");

  const presence = publicReleaseConfigPresence(good);
  if (!presence.ok || presence.missing.length !== 0) fail("self-test valid configuration presence failed");
  const missingPresence = publicReleaseConfigPresence({ ...good, OPENAI_APPS_CHALLENGE_TOKEN: "" });
  if (missingPresence.ok || !missingPresence.missing.includes("OPENAI_APPS_CHALLENGE_TOKEN")) {
    fail("self-test missing configuration presence failed");
  }

  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "http://mcp.zssh.dev/mcp" }), /https/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://127.0.0.1/mcp" }), /public hostname/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://mcp.zssh.dev/other" }), /\/mcp endpoint/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://mcp.zssh.dev/mcp?target=review" }), /query parameters/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_DEMO_RECORDING_URL: "http://review.example/demo" }), /HTTPS URL/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_WRITE_FILE: good.ZSSH_REVIEW_FILE }), /different files/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_ACCESS_TOKEN: "short" }), /at least 20/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_LOGIN_URL: "https://127.0.0.1/login" }), /public DNS hostname/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_CREDENTIALS_VERIFIED: "0" }), /must be exactly 1/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_CHATGPT_DESKTOP_REVIEWED: "0" }), /ChatGPT desktop/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_CHATGPT_MOBILE_REVIEWED: "0" }), /ChatGPT mobile/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_DOMAIN_VERIFIED: "0" }), /Verify Domain has passed/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://old-mcp.zssh.dev" }), /stale or for a different endpoint/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "0" }), /Scan Tools has completed successfully/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_TOOL_SCAN_SHA256: "stale" }), /64-character lowercase SHA-256/);

  console.log("PUBLIC_RELEASE_PREFLIGHT_SELF_TEST_GREEN");
}

if (argv.has("--self-test")) {
  runSelfTest();
} else if (argv.has("--presence-json")) {
  console.log(JSON.stringify(publicReleaseConfigPresence(process.env), null, 2));
} else {
  const result = validatePublicReleaseConfig(process.env);
  if (argv.has("--json")) console.log(JSON.stringify(result));
  else {
    console.log("PUBLIC_RELEASE_PREFLIGHT_GREEN");
    console.log(JSON.stringify(result));
  }
}
