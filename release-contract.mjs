import { createHash } from "node:crypto";

function fail(message) {
  throw new Error(message);
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

export function isNonPublicHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (isPrivateIpv4(host)) return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return [".local", ".localhost", ".test", ".example", ".invalid"].some(suffix => host.endsWith(suffix));
}

export function validatePublicMcpUrl(raw, {
  name = "MCP URL",
  allowHttp = false,
  requirePublicHostname = true,
} = {}) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    fail(`${name} must be a valid URL`);
  }

  const allowedProtocol = allowHttp ? ["http:", "https:"] : ["https:"];
  if (!allowedProtocol.includes(url.protocol)) {
    fail(`${name} must use ${allowHttp ? "http or https" : "https"}`);
  }
  if (url.username || url.password) fail(`${name} must not contain URL credentials`);
  if (url.search || url.hash) fail(`${name} must not contain query parameters or fragments`);
  if (requirePublicHostname && isNonPublicHostname(url.hostname)) {
    fail(`${name} must use a public hostname`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath !== "/mcp") fail(`${name} must point to the /mcp endpoint`);

  return url;
}

export function protectedResourceMetadataUrl(mcpUrl) {
  const url = mcpUrl instanceof URL ? mcpUrl : new URL(mcpUrl);
  return new URL("/.well-known/oauth-protected-resource", url.origin);
}

export function assertExactBearerResourceMetadata(headerValue, expectedUrl) {
  const header = String(headerValue || "");
  if (!/^Bearer\b/i.test(header)) fail("401 response is missing Bearer authentication challenge");

  const match = header.match(/(?:^|[,\s])resource_metadata="([^"]+)"/i);
  if (!match) fail("401 response is missing resource_metadata challenge");

  let actual;
  try {
    actual = new URL(match[1]);
  } catch {
    fail("resource_metadata challenge is not a valid URL");
  }

  const expected = expectedUrl instanceof URL ? expectedUrl : new URL(expectedUrl);
  if (actual.href !== expected.href) {
    fail(`resource_metadata challenge mismatch: expected ${expected.href}, got ${actual.href}`);
  }
  return actual;
}

export async function fetchNoRedirect(input, init = {}, label = "request") {
  const response = await fetch(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new Error(`${label} must not redirect${location ? `: ${location}` : ""}`);
  }
  return response;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

export function publicToolContractFingerprint(tools) {
  const normalized = [...(tools || [])]
    .map(tool => ({
      name: tool?.name,
      title: tool?.title,
      description: tool?.description,
      inputSchema: tool?.inputSchema,
      outputSchema: tool?.outputSchema,
      securitySchemes: tool?.securitySchemes,
      annotations: tool?.annotations,
      _meta: tool?._meta,
    }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const canonical = JSON.stringify(canonicalize(normalized));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
