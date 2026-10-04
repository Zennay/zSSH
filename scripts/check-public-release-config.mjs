#!/usr/bin/env node
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validatePublicMcpUrl } from "../release-contract.mjs";
import { assertDomainVerificationBinding } from "./check-domain-verification-binding.mjs";
import {
  assertHostSurfaceReviewBinding,
  computeHostSurfaceReviewFingerprint,
} from "./check-host-surface-review-binding.mjs";

const argv = new Set(process.argv.slice(2));

const REQUIRED_RELEASE_CONFIG = [
  "ZSSH_PLUGIN_MCP_URL",
  "ZSSH_PLUGIN_DEMO_RECORDING_URL",
  "ZSSH_REVIEW_ACCESS_TOKEN",
  "ZSSH_REVIEW_LOGIN_URL",
  "ZSSH_REVIEW_LOGIN_VERIFIED_URL",
  "ZSSH_REVIEW_CREDENTIALS_VERIFIED",
  "ZSSH_MAIN_PROTECTION_VERIFIED",
  "ZSSH_CHATGPT_DESKTOP_REVIEWED",
  "ZSSH_CHATGPT_MOBILE_REVIEWED",
  "ZSSH_CHATGPT_REVIEW_SHA256",
  "ZSSH_OPENAI_DOMAIN_VERIFIED",
  "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN",
  "ZSSH_OPENAI_TOOL_SCAN_VERIFIED",
  "ZSSH_OPENAI_TOOL_SCAN_SHA256",
  "ZSSH_OAUTH_ISSUER",
  "AUTH0_MANAGEMENT_BASE_URL",
  "AUTH0_MANAGEMENT_API_TOKEN",
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
  const oauthIssuerUrl = requirePublicHttpsUrl(env, "ZSSH_OAUTH_ISSUER");
  const auth0ManagementBaseUrl = requirePublicHttpsUrl(env, "AUTH0_MANAGEMENT_BASE_URL");
  const auth0ManagementToken = requireValue(env, "AUTH0_MANAGEMENT_API_TOKEN", { minLength: 20 });
  const accessToken = requireValue(env, "ZSSH_REVIEW_ACCESS_TOKEN", { minLength: 20 });
  const reviewLoginUrl = requirePublicHttpsUrl(env, "ZSSH_REVIEW_LOGIN_URL");
  const reviewLoginVerifiedUrl = requirePublicHttpsUrl(env, "ZSSH_REVIEW_LOGIN_VERIFIED_URL");
  if (reviewLoginVerifiedUrl.href !== reviewLoginUrl.href) {
    fail("reviewer login verification is stale: ZSSH_REVIEW_LOGIN_VERIFIED_URL must match the exact ZSSH_REVIEW_LOGIN_URL that was tested");
  }
  const reviewCredentialsVerified = requireValue(env, "ZSSH_REVIEW_CREDENTIALS_VERIFIED");
  if (reviewCredentialsVerified !== "1") {
    fail("ZSSH_REVIEW_CREDENTIALS_VERIFIED must be exactly 1 after the dedicated reviewer login has been tested without MFA, email/SMS confirmation, magic links, or private-network access");
  }
  const mainProtectionVerified = requireValue(env, "ZSSH_MAIN_PROTECTION_VERIFIED");
  if (mainProtectionVerified !== "1") {
    fail("ZSSH_MAIN_PROTECTION_VERIFIED must be exactly 1 only after main rejects direct pushes, requires PR-based changes, and the required zSSH CI/repository-hygiene check has been proven by a controlled negative test");
  }
  const chatgptDesktopReviewed = requireValue(env, "ZSSH_CHATGPT_DESKTOP_REVIEWED");
  if (chatgptDesktopReviewed !== "1") {
    fail("ZSSH_CHATGPT_DESKTOP_REVIEWED must be exactly 1 only after the production connection card has been exercised successfully in ChatGPT desktop");
  }
  const chatgptMobileReviewed = requireValue(env, "ZSSH_CHATGPT_MOBILE_REVIEWED");
  if (chatgptMobileReviewed !== "1") {
    fail("ZSSH_CHATGPT_MOBILE_REVIEWED must be exactly 1 only after the production connection card has been exercised successfully in ChatGPT mobile");
  }
  const chatgptReviewBinding = assertHostSurfaceReviewBinding(
    mcpUrl.href,
    requireValue(env, "ZSSH_OPENAI_TOOL_SCAN_SHA256"),
    requireValue(env, "ZSSH_CHATGPT_REVIEW_SHA256")
  );
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
    oauth_provider: "auth0",
    oauth_issuer: oauthIssuerUrl.href.replace(/\/$/, ""),
    auth0_management_origin: auth0ManagementBaseUrl.origin,
    auth0_management_token_present: auth0ManagementToken.length > 0,
    review_login_origin: reviewLoginUrl.origin,
    review_login_path: reviewLoginUrl.pathname,
    review_login_verified_url: reviewLoginVerifiedUrl.href,
    review_credentials_verified: true,
    main_protection_verified: true,
    chatgpt_desktop_reviewed: true,
    chatgpt_mobile_reviewed: true,
    chatgpt_review_sha256: chatgptReviewBinding.chatgpt_review_sha256,
    connection_card_sha256: chatgptReviewBinding.connection_card_sha256,
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
    ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://auth.zssh.dev/login",
    ZSSH_REVIEW_CREDENTIALS_VERIFIED: "1",
    ZSSH_MAIN_PROTECTION_VERIFIED: "1",
    ZSSH_CHATGPT_DESKTOP_REVIEWED: "1",
    ZSSH_CHATGPT_MOBILE_REVIEWED: "1",
    ZSSH_CHATGPT_REVIEW_SHA256: "",
    ZSSH_OPENAI_DOMAIN_VERIFIED: "1",
    ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://mcp.zssh.dev",
    ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "1",
    ZSSH_OPENAI_TOOL_SCAN_SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ZSSH_OAUTH_ISSUER: "https://tenant.eu.auth0.com/",
    AUTH0_MANAGEMENT_BASE_URL: "https://tenant.eu.auth0.com",
    AUTH0_MANAGEMENT_API_TOKEN: "management-token-0123456789abcdef",
    OPENAI_APPS_CHALLENGE_TOKEN: "challenge-0123456789abcdef",
    ZSSH_REVIEW_FILE: "/srv/zssh-review/sample.txt",
    ZSSH_REVIEW_WRITE_FILE: "/srv/zssh-review/output.txt"
  };
  good.ZSSH_CHATGPT_REVIEW_SHA256 = computeHostSurfaceReviewFingerprint({
    mcpUrl: good.ZSSH_PLUGIN_MCP_URL,
    toolScanSha256: good.ZSSH_OPENAI_TOOL_SCAN_SHA256,
  }).fingerprint;
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
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OAUTH_ISSUER: "http://tenant.eu.auth0.com" }), /HTTPS URL/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, AUTH0_MANAGEMENT_BASE_URL: "https://127.0.0.1" }), /public DNS hostname/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, AUTH0_MANAGEMENT_API_TOKEN: "short" }), /at least 20/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_WRITE_FILE: good.ZSSH_REVIEW_FILE }), /different files/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_ACCESS_TOKEN: "short" }), /at least 20/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_LOGIN_URL: "https://127.0.0.1/login" }), /public DNS hostname/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_LOGIN_VERIFIED_URL: "https://auth.zssh.dev/old-login" }), /verification is stale/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_CREDENTIALS_VERIFIED: "0" }), /must be exactly 1/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_MAIN_PROTECTION_VERIFIED: "0" }), /main rejects direct pushes/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_CHATGPT_DESKTOP_REVIEWED: "0" }), /ChatGPT desktop/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_CHATGPT_MOBILE_REVIEWED: "0" }), /ChatGPT mobile/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_CHATGPT_REVIEW_SHA256: "0".repeat(64) }), /attestation is stale/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_DOMAIN_VERIFIED: "0" }), /Verify Domain has passed/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_VERIFIED_MCP_ORIGIN: "https://old-mcp.zssh.dev" }), /stale or for a different endpoint/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_TOOL_SCAN_VERIFIED: "0" }), /Scan Tools has completed successfully/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_OPENAI_TOOL_SCAN_SHA256: "stale" }), /64-character lowercase SHA-256/);

  console.log("PUBLIC_RELEASE_PREFLIGHT_SELF_TEST_GREEN");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
