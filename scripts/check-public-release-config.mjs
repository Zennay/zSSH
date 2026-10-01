#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { validatePublicMcpUrl } from "../release-contract.mjs";

const argv = new Set(process.argv.slice(2));

function fail(message) {
  throw new Error(message);
}

function requireValue(env, name, { minLength = 1 } = {}) {
  const value = String(env[name] || "").trim();
  if (value.length < minLength) fail(`${name} is required and must be at least ${minLength} characters`);
  return value;
}

export function validatePublicReleaseConfig(env = process.env) {
  const mcpUrl = validatePublicMcpUrl(
    requireValue(env, "ZSSH_PLUGIN_MCP_URL"),
    { name: "ZSSH_PLUGIN_MCP_URL" }
  );
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
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://mcp.zssh.dev/other" }), /\/mcp endpoint/);
  assertThrows(() => validatePublicReleaseConfig({ ...good, ZSSH_PLUGIN_MCP_URL: "https://mcp.zssh.dev/mcp?target=review" }), /query parameters/);
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
