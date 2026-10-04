import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { pathToFileURL } from "node:url";
import {
  assertExactBearerResourceMetadata,
  protectedResourceMetadataUrl,
  validatePublicMcpUrl,
} from "../release-contract.mjs";

function fail(message) {
  throw new Error(message);
}

function redirectFailure(response, label) {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    fail(label + " must not redirect" + (location ? ": " + location : ""));
  }
}

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return false;
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(value)) return false;
  if (/^fe[89ab][0-9a-f]:/.test(value)) return false;
  if (/^ff[0-9a-f]{2}:/.test(value)) return false;
  if (/^2001:db8(?::|$)/.test(value)) return false;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isPublicIpv4(mapped);
  }
  return true;
}

export function isPublicRoutableAddress(address) {
  const value = String(address || "").trim();
  const family = net.isIP(value);
  if (family === 4) return isPublicIpv4(value);
  if (family === 6) return isPublicIpv6(value);
  return false;
}

export async function checkPublicIngress(rawMcpUrl, {
  lookupImpl = dnsLookup,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const mcpUrl = validatePublicMcpUrl(rawMcpUrl, { name: "ZSSH_PLUGIN_MCP_URL" });
  if (!mcpUrl.hostname.includes(".")) {
    fail("ZSSH_PLUGIN_MCP_URL must use a DNS hostname");
  }
  if (mcpUrl.port && mcpUrl.port !== "443") {
    fail("ZSSH_PLUGIN_MCP_URL must use the standard HTTPS port");
  }

  let records;
  try {
    records = await lookupImpl(mcpUrl.hostname, { all: true, verbatim: true });
  } catch (error) {
    fail("public DNS lookup failed: " + (error instanceof Error ? error.message : String(error)));
  }
  if (!Array.isArray(records) || records.length < 1) {
    fail("public DNS lookup returned no addresses");
  }

  const normalizedRecords = records.map(record => ({
    address: String(record?.address || ""),
    family: Number(record?.family || net.isIP(String(record?.address || ""))),
  }));
  const nonPublic = normalizedRecords.filter(record => !isPublicRoutableAddress(record.address));
  if (nonPublic.length > 0) {
    fail("public DNS must resolve only to publicly routable addresses");
  }

  const requestSignal = () => AbortSignal.timeout(timeoutMs);
  const healthUrl = new URL("/health", mcpUrl.origin);
  const healthResponse = await fetchImpl(healthUrl, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: requestSignal(),
  });
  redirectFailure(healthResponse, "public health endpoint");
  if (healthResponse.status !== 200) {
    fail("public health endpoint failed: HTTP " + healthResponse.status);
  }
  const healthType = healthResponse.headers.get("content-type") || "";
  if (!healthType.toLowerCase().startsWith("application/json")) {
    fail("public health endpoint must return application/json");
  }
  let health;
  try {
    health = await healthResponse.json();
  } catch {
    fail("public health endpoint returned invalid JSON");
  }
  if (health?.ok !== true || health?.service !== "zssh") {
    fail("public health endpoint did not identify a healthy zSSH service");
  }

  const metadataUrl = protectedResourceMetadataUrl(mcpUrl);
  const unauthenticated = await fetchImpl(mcpUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    signal: requestSignal(),
  });
  redirectFailure(unauthenticated, "unauthenticated public MCP endpoint");
  if (unauthenticated.status !== 401) {
    fail("unauthenticated public MCP endpoint must return 401, got " + unauthenticated.status);
  }
  assertExactBearerResourceMetadata(
    unauthenticated.headers.get("www-authenticate") || "",
    metadataUrl,
  );

  const metadataResponse = await fetchImpl(metadataUrl, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: requestSignal(),
  });
  redirectFailure(metadataResponse, "OAuth protected-resource metadata");
  if (metadataResponse.status !== 200) {
    fail("OAuth protected-resource metadata failed: HTTP " + metadataResponse.status);
  }
  let metadata;
  try {
    metadata = await metadataResponse.json();
  } catch {
    fail("OAuth protected-resource metadata returned invalid JSON");
  }
  if (metadata?.resource !== mcpUrl.origin) {
    fail("OAuth protected-resource metadata resource must equal the exact public origin");
  }
  if (!Array.isArray(metadata?.authorization_servers) || metadata.authorization_servers.length < 1) {
    fail("OAuth protected-resource metadata must advertise an authorization server");
  }

  return {
    ok: true,
    mcp_url: mcpUrl.href,
    endpoint_origin: mcpUrl.origin,
    dns_address_count: normalizedRecords.length,
    dns_families: [...new Set(normalizedRecords.map(record => record.family))].sort(),
    https_health_validated: true,
    unauthenticated_mcp_401_validated: true,
    protected_resource_metadata_validated: true,
  };
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
} = {}) {
  const rawMcpUrl = String(argv[0] || env.ZSSH_PLUGIN_MCP_URL || "").trim();
  const result = await checkPublicIngress(rawMcpUrl);
  stdout.write(JSON.stringify(result, null, 2) + "\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
