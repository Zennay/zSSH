import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

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
  if (["example.com", "example.net", "example.org"].some(domain => host === domain || host.endsWith("." + domain))) return true;
  return [".local", ".localhost", ".test", ".example", ".invalid"].some(suffix => host.endsWith(suffix));
}

function validatePublicHttpsUrl(raw, {
  name = "URL",
  allowHttp = false,
  requirePublicHostname = true,
  allowQuery = true,
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
  if (!allowQuery && (url.search || url.hash)) fail(`${name} must not contain query parameters or fragments`);
  if (url.hash) fail(`${name} must not contain a fragment`);
  const normalizedHostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    requirePublicHostname &&
    (!normalizedHostname.includes(".") ||
      isIP(normalizedHostname) !== 0 ||
      isNonPublicHostname(normalizedHostname))
  ) {
    fail(`${name} must use a public hostname`);
  }
  return url;
}

export function validatePublicMcpUrl(raw, {
  name = "MCP URL",
  allowHttp = false,
  requirePublicHostname = true,
} = {}) {
  const url = validatePublicHttpsUrl(raw, {
    name,
    allowHttp,
    requirePublicHostname,
    allowQuery: false,
  });

  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath !== "/mcp") fail(`${name} must point to the /mcp endpoint`);

  return url;
}

export function protectedResourceMetadataUrl(mcpUrl) {
  const url = mcpUrl instanceof URL ? mcpUrl : new URL(mcpUrl);
  return new URL("/.well-known/oauth-protected-resource", url.origin);
}

export function authorizationServerMetadataUrls(rawIssuer, {
  allowHttp = false,
  requirePublicHostname = true,
} = {}) {
  const issuer = validatePublicHttpsUrl(rawIssuer, {
    name: "OAuth authorization server issuer",
    allowHttp,
    requirePublicHostname,
    allowQuery: false,
  });
  const path = issuer.pathname.replace(/\/+$/, "");
  const oauth = new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin);
  const oidc = new URL(`${path}/.well-known/openid-configuration`, issuer.origin);
  return [...new Map([oauth, oidc].map(url => [url.href, url])).values()];
}

function normalizeIssuer(raw, options) {
  const url = validatePublicHttpsUrl(raw, {
    name: "OAuth authorization server issuer",
    ...options,
    allowQuery: false,
  });
  return url.href.replace(/\/$/, "");
}

function validateMetadataEndpoint(raw, field, options) {
  return validatePublicHttpsUrl(raw, {
    name: `OAuth metadata ${field}`,
    ...options,
    allowQuery: true,
  }).href;
}

export function validateAuthorizationServerMetadata(metadata, expectedIssuer, {
  allowHttp = false,
  requirePublicHostname = true,
} = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("OAuth authorization server metadata must be a JSON object");
  }

  const urlOptions = { allowHttp, requirePublicHostname };
  const expected = normalizeIssuer(expectedIssuer, urlOptions);
  const actual = normalizeIssuer(metadata.issuer, urlOptions);
  if (actual !== expected) {
    fail(`OAuth authorization server issuer mismatch: expected ${expected}, got ${actual}`);
  }

  const authorizationEndpoint = validateMetadataEndpoint(
    metadata.authorization_endpoint,
    "authorization_endpoint",
    urlOptions
  );
  const tokenEndpoint = validateMetadataEndpoint(
    metadata.token_endpoint,
    "token_endpoint",
    urlOptions
  );

  if (!Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes("code")) {
    fail("OAuth authorization server metadata must advertise authorization-code response type");
  }
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256")) {
    fail("OAuth authorization server metadata must advertise PKCE S256");
  }
  if (!Array.isArray(metadata.token_endpoint_auth_methods_supported) || metadata.token_endpoint_auth_methods_supported.length < 1) {
    fail("OAuth authorization server metadata must publish token_endpoint_auth_methods_supported");
  }

  const registrationEndpoint = metadata.registration_endpoint
    ? validateMetadataEndpoint(metadata.registration_endpoint, "registration_endpoint", urlOptions)
    : null;
  const clientIdMetadataDocumentSupported = metadata.client_id_metadata_document_supported === true;
  const clientRegistrationMethods = [];
  if (clientIdMetadataDocumentSupported) clientRegistrationMethods.push("cimd");
  if (registrationEndpoint) clientRegistrationMethods.push("dcr");
  if (clientRegistrationMethods.length === 0) {
    fail("OAuth authorization server metadata must support ChatGPT client identification via CIMD or DCR");
  }

  return {
    issuer: actual,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    registration_endpoint: registrationEndpoint,
    client_id_metadata_document_supported: clientIdMetadataDocumentSupported,
    client_registration_methods: clientRegistrationMethods,
    authorization_response_iss_parameter_supported: metadata.authorization_response_iss_parameter_supported === true,
    pkce_s256: true,
    authorization_code: true,
    token_endpoint_auth_methods: [...new Set(metadata.token_endpoint_auth_methods_supported.map(String))],
  };
}

export async function fetchAuthorizationServerMetadata(rawIssuer, {
  allowHttp = false,
  requirePublicHostname = true,
  fetchImpl = fetch,
} = {}) {
  const candidates = authorizationServerMetadataUrls(rawIssuer, { allowHttp, requirePublicHostname });
  let lastStatus = null;

  for (const candidate of candidates) {
    const response = await fetchImpl(candidate, { redirect: "manual", headers: { accept: "application/json" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      fail(`OAuth authorization server metadata must not redirect${location ? `: ${location}` : ""}`);
    }
    if (response.status === 404) {
      lastStatus = response.status;
      continue;
    }
    if (!response.ok) {
      fail(`OAuth authorization server metadata failed: HTTP ${response.status}`);
    }

    let metadata;
    try {
      metadata = await response.json();
    } catch {
      fail("OAuth authorization server metadata is not valid JSON");
    }
    const validated = validateAuthorizationServerMetadata(metadata, rawIssuer, {
      allowHttp,
      requirePublicHostname,
    });
    return {
      url: candidate.href,
      metadata,
      validated,
    };
  }

  fail(`OAuth authorization server metadata was not found${lastStatus ? ` (last HTTP ${lastStatus})` : ""}`);
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

export const PUBLIC_TOOL_SCOPE_CONTRACT = Object.freeze(
  JSON.parse(readFileSync(new URL("./submission/public-tool-contract.json", import.meta.url), "utf8"))
);

export function assertReviewTestCasesMatchPublicToolContract(
  manifest,
  expected = PUBLIC_TOOL_SCOPE_CONTRACT,
) {
  const testCases = manifest?.extensions?.["com.openai"]?.review?.test_cases;
  const positive = testCases?.positive;
  const negative = testCases?.negative;

  if (!Array.isArray(positive) || positive.length !== 5) {
    fail("OpenAI MCP review requires exactly five positive test cases");
  }
  if (!Array.isArray(negative) || negative.length !== 3) {
    fail("OpenAI MCP review requires exactly three negative test cases");
  }

  const allowed = new Set(Object.keys(expected));
  const referenced = new Set();

  for (const [index, item] of positive.entries()) {
    for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      if (!String(item?.[field] || "").trim()) {
        fail(`positive review case ${index + 1} is missing ${field}`);
      }
    }

    const names = String(item.tools_triggered)
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    if (new Set(names).size !== names.length) {
      fail(`positive review case ${index + 1} contains duplicate tools_triggered names`);
    }

    const unknown = names.filter(name => !allowed.has(name));
    if (unknown.length > 0) {
      fail(
        `positive review case ${index + 1} references tools outside the reviewed public contract: ${unknown.join(", ")}`,
      );
    }
    names.forEach(name => referenced.add(name));
  }

  for (const [index, item] of negative.entries()) {
    for (const field of ["description", "prompt"]) {
      if (!String(item?.[field] || "").trim()) {
        fail(`negative review case ${index + 1} is missing ${field}`);
      }
    }
  }

  return {
    positive_count: positive.length,
    negative_count: negative.length,
    referenced_tools: [...referenced].sort(),
  };
}

function assertExactOAuthScheme(tool, location, schemes, expectedScope) {
  if (!Array.isArray(schemes)) {
    fail(`${tool.name} is missing ${location} OAuth security metadata`);
  }
  if (schemes.length !== 1 || schemes[0]?.type !== "oauth2") {
    fail(`${tool.name} ${location} must contain exactly one oauth2 security scheme`);
  }
  const scopes = Array.isArray(schemes[0].scopes)
    ? [...new Set(schemes[0].scopes.map(String))].sort()
    : [];
  if (scopes.length !== 1 || scopes[0] !== expectedScope) {
    fail(`${tool.name} ${location} must require exactly ${expectedScope}`);
  }
}

export function validateProductionServerInfo(info, { requireOutboundAgent = false } = {}) {
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    fail("production server info must be an object");
  }
  if (info.plugin_profile !== "public" || info.auth_mode !== "oauth" || info.pairing_required !== true) {
    fail("production server policy is not public+oauth+pairing");
  }
  for (const field of ["hostname", "uid", "allowed_roots", "safe_programs"]) {
    if (Object.hasOwn(info, field)) fail("public server_info exposes private field: " + field);
  }
  const outboundAgent = info.transport === "outbound-agent";
  if (requireOutboundAgent && !outboundAgent) {
    fail("production server is not using the required outbound-agent transport");
  }
  return {
    public_policy_validated: true,
    outbound_agent_transport_validated: outboundAgent,
  };
}

export function assertPublicToolScopeContract(tools, expected = PUBLIC_TOOL_SCOPE_CONTRACT) {
  if (!Array.isArray(tools)) fail("public tool scope contract requires a tool array");
  const byName = new Map();
  for (const tool of tools) {
    const name = String(tool?.name || "");
    if (!name) fail("public tool scan contains an unnamed tool");
    if (byName.has(name)) fail(`public tool scan contains duplicate tool: ${name}`);
    byName.set(name, tool);
  }

  const expectedNames = Object.keys(expected).sort();
  const actualNames = [...byName.keys()].sort();
  const missing = expectedNames.filter(name => !byName.has(name));
  const unreviewed = actualNames.filter(name => !Object.hasOwn(expected, name));
  if (missing.length) fail(`public tool scan is missing reviewed tools: ${missing.join(", ")}`);
  if (unreviewed.length) fail(`public tool scan exposes unreviewed tools: ${unreviewed.join(", ")}`);

  for (const [name, expectedScope] of Object.entries(expected)) {
    const tool = byName.get(name);
    // The MCP SDK serializes security metadata reliably through _meta.
    // Some client versions omit the duplicate top-level securitySchemes field,
    // so require the wire-visible _meta contract and validate top-level metadata
    // as well whenever it is present.
    assertExactOAuthScheme(tool, "_meta.securitySchemes", tool?._meta?.securitySchemes, expectedScope);
    if (tool.securitySchemes !== undefined) {
      assertExactOAuthScheme(tool, "securitySchemes", tool.securitySchemes, expectedScope);
    }
  }
  return true;
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
