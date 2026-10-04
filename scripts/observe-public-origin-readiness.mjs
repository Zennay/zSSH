#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { checkPublicIngress } from "./check-public-ingress.mjs";

export const DEFAULT_PRODUCTION_MCP_URL = "https://zssh.cheapgpt.shop/mcp";

export function classifyPublicIngressFailure(message) {
  const value = String(message || "");

  if (
    /ZSSH_PLUGIN_MCP_URL|public HTTPS \/mcp endpoint|standard HTTPS port|DNS hostname/i.test(value)
  ) {
    return "url_contract";
  }
  if (/public DNS/i.test(value)) return "dns";
  if (/public health endpoint/i.test(value)) return "https_health";
  if (/unauthenticated public MCP|Bearer resource_metadata/i.test(value)) return "mcp_auth";
  if (/OAuth protected-resource metadata|authorization server|exact public origin/i.test(value)) {
    return "oauth_metadata";
  }
  if (/fetch failed|network|timeout|timed out|aborted/i.test(value)) return "transport";
  return "unknown";
}

export async function observePublicOrigin(
  rawMcpUrl = DEFAULT_PRODUCTION_MCP_URL,
  { checkImpl = checkPublicIngress } = {},
) {
  const mcpUrl = String(rawMcpUrl || DEFAULT_PRODUCTION_MCP_URL).trim();

  try {
    const evidence = await checkImpl(mcpUrl);
    return {
      schema_version: 1,
      mcp_url: mcpUrl,
      ready: true,
      stage: "ready",
      evidence,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      schema_version: 1,
      mcp_url: mcpUrl,
      ready: false,
      stage: classifyPublicIngressFailure(reason),
      reason,
    };
  }
}

export async function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
} = {}) {
  const result = await observePublicOrigin(argv[0] || DEFAULT_PRODUCTION_MCP_URL);
  stdout.write(JSON.stringify(result, null, 2) + "\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
