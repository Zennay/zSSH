#!/usr/bin/env node
import process from "node:process";
import {
  isNonPublicHostname,
  validatePublicMcpUrl,
} from "../release-contract.mjs";

function fail(message) {
  throw new Error(message);
}

function requireVerifiedOrigin(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    fail("ZSSH_OPENAI_VERIFIED_MCP_ORIGIN must be a valid HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("ZSSH_OPENAI_VERIFIED_MCP_ORIGIN must be an HTTPS origin without embedded credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    fail("ZSSH_OPENAI_VERIFIED_MCP_ORIGIN must contain only scheme, hostname, and optional port");
  }
  if (isNonPublicHostname(url.hostname)) {
    fail("ZSSH_OPENAI_VERIFIED_MCP_ORIGIN must use a public hostname");
  }
  return url;
}

export function assertDomainVerificationBinding(mcpUrlRaw, verifiedOriginRaw) {
  const mcpUrl = validatePublicMcpUrl(mcpUrlRaw, {
    name: "ZSSH_PLUGIN_MCP_URL",
  });
  const verified = requireVerifiedOrigin(verifiedOriginRaw);
  if (verified.origin !== mcpUrl.origin) {
    fail(
      "OpenAI Verify Domain attestation is stale or for a different endpoint: " +
      "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN must match the exact ZSSH_PLUGIN_MCP_URL origin"
    );
  }
  return {
    ok: true,
    mcp_origin: mcpUrl.origin,
    verified_mcp_origin: verified.origin,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(assertDomainVerificationBinding(
    process.env.ZSSH_PLUGIN_MCP_URL,
    process.env.ZSSH_OPENAI_VERIFIED_MCP_ORIGIN
  ), null, 2));
}
