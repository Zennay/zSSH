#!/usr/bin/env node
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { validatePublicMcpUrl } from "../release-contract.mjs";

const DEFAULT_CONNECTION_CARD = new URL("../ui/connection-card.html", import.meta.url);

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function computeHostSurfaceReviewFingerprint({
  mcpUrl,
  toolScanSha256,
  connectionCardHtml = readFileSync(DEFAULT_CONNECTION_CARD, "utf8"),
}) {
  const endpoint = validatePublicMcpUrl(mcpUrl, { name: "ZSSH_PLUGIN_MCP_URL" });
  const toolScan = requireSha256(toolScanSha256, "ZSSH_OPENAI_TOOL_SCAN_SHA256");
  const connectionCardSha256 = sha256(connectionCardHtml);
  const payload = JSON.stringify({
    schema_version: 1,
    mcp_origin: endpoint.origin,
    mcp_path: endpoint.pathname,
    tool_scan_sha256: toolScan,
    connection_card_sha256: connectionCardSha256,
  });
  return {
    fingerprint: sha256(payload),
    mcp_origin: endpoint.origin,
    mcp_path: endpoint.pathname,
    tool_scan_sha256: toolScan,
    connection_card_sha256: connectionCardSha256,
  };
}

export function assertHostSurfaceReviewBinding(
  mcpUrl,
  toolScanSha256,
  attestedFingerprint,
  { connectionCardHtml } = {}
) {
  const attested = requireSha256(attestedFingerprint, "ZSSH_CHATGPT_REVIEW_SHA256");
  const current = computeHostSurfaceReviewFingerprint({
    mcpUrl,
    toolScanSha256,
    ...(connectionCardHtml === undefined ? {} : { connectionCardHtml }),
  });
  if (attested !== current.fingerprint) {
    fail(
      "ChatGPT desktop/mobile review attestation is stale: " +
      "ZSSH_CHATGPT_REVIEW_SHA256 must match the exact production MCP endpoint, tool contract, and connection-card UI"
    );
  }
  return {
    ok: true,
    chatgpt_review_sha256: attested,
    connection_card_sha256: current.connection_card_sha256,
    mcp_origin: current.mcp_origin,
    mcp_path: current.mcp_path,
    tool_scan_sha256: current.tool_scan_sha256,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes("--compute")) {
    console.log(computeHostSurfaceReviewFingerprint({
      mcpUrl: process.env.ZSSH_PLUGIN_MCP_URL,
      toolScanSha256: process.env.ZSSH_OPENAI_TOOL_SCAN_SHA256,
    }).fingerprint);
  } else {
    console.log(JSON.stringify(assertHostSurfaceReviewBinding(
      process.env.ZSSH_PLUGIN_MCP_URL,
      process.env.ZSSH_OPENAI_TOOL_SCAN_SHA256,
      process.env.ZSSH_CHATGPT_REVIEW_SHA256
    ), null, 2));
  }
}
