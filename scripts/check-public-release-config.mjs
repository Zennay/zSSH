#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

const argv = new Set(process.argv.slice(2));

function fail(message) {
  throw new Error(message);
}

function requireValue(env, name, { minLength = 1 } = {}) {
  const value = String(env[name] || "").trim();
  if (value.length < minLength) fail(`${name} is required and must be at least ${minLength} characters`);
  return value;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function isNonPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (isPrivateIpv4(host)) return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return [".local", ".localhost", ".test", ".example", ".invalid"].some(suffix => host.endsWith(suffix));
}

function validateHttpsUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:") fail(`${name} must use https`);
  if (url.username || url.password) fail(`${name} must not contain URL credentials`);
  if (url.search || url.hash) fail(`${name} must not contain query parameters or fragments`);
  if (isNonPublicHostname(url.hostname)) fail(`${name} must use a public hostname`);
  return url;
}

export function validatePublicReleaseConfig(env = process.env) {
  const mcpUrl = validateHttpsUrl(requireValue(env, "ZSSH_PLUGIN_MCP_URL"), "ZSSH_PLUGIN_MCP_URL");
  const accessToken = requireValue(env, "ZSSH_REVIEW_ACCESS_TOKEN", { minLength: 20 });
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
    ZSSH_REVIEW_ACCESS_TOKEN: "review-token-0123456789abcdef",
    OPENAI_APPS_CHALLENGE_TOKEN: "challenge-0123456789abcdef",
    ZSSH_REVIEW_FILE: "/srv/zssh-review/sample.txt",
    ZSSH_REVIEW_WRITE_FILE: "/srv/zssh-review/output.txt"
  };
  const result = validatePublicReleaseConfig(good);
  if (!result.ok || result.endpoint_path !== "/mcp") fail("self-test valid configuration failed");

  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "http://mcp.zssh.dev/mcp" }), /https/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://127.0.0.1/mcp" }), /public hostname/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_WRITE_FILE: good.ZSSH_REVIEW_FILE }), /different files/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_REVIEW_ACCESS_TOKEN: "short" }), /at least 20/);

  console.log("PUBLIC_RELEASE_PREFLIGHT_SELF_TEST_GREEN");
}

if (argv.has("--self-test")) {
  runSelfTest();
} else {
  const result = validatePublicReleaseConfig(process.env);
  if (argv.has("--json")) console.log(JSON.stringify(result));
  else {
    console.log("PUBLIC_RELEASE_PREFLIGHT_GREEN");
    console.log(JSON.stringify(result));
  }
}
