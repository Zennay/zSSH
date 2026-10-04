import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  assertExactBearerResourceMetadata,
  assertPublicToolScopeContract,
  fetchAuthorizationServerMetadata,
  fetchNoRedirect,
  isNonPublicHostname,
  protectedResourceMetadataUrl,
  publicToolContractFingerprint,
  validateProductionServerInfo,
  validatePublicMcpUrl,
} from "./release-contract.mjs";
import { assertAnnotationJustificationsMatchTools, loadAnnotationJustifications } from "./annotation-justifications.mjs";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function textPart(result) {
  return result?.content?.find(part => part.type === "text")?.text || "";
}

function jsonResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = textPart(result);
  try {
    return JSON.parse(text || "{}");
  } catch {
    return { text };
  }
}

const allowHttp = process.env.ZSSH_PROBE_ALLOW_HTTP === "1";
const mcpUrl = validatePublicMcpUrl(required("ZSSH_PLUGIN_MCP_URL"), {
  name: "ZSSH_PLUGIN_MCP_URL",
  allowHttp,
  requirePublicHostname: !allowHttp,
});

const accessToken = required("ZSSH_REVIEW_ACCESS_TOKEN");
const demoRecordingUrl = new URL(required("ZSSH_PLUGIN_DEMO_RECORDING_URL"));
if ((allowHttp ? !["http:", "https:"].includes(demoRecordingUrl.protocol) : demoRecordingUrl.protocol !== "https:") ||
    demoRecordingUrl.username || demoRecordingUrl.password || demoRecordingUrl.hash) {
  throw new Error("ZSSH_PLUGIN_DEMO_RECORDING_URL must be a reviewer-accessible HTTPS URL without credentials or fragment");
}
if (!allowHttp && isNonPublicHostname(demoRecordingUrl.hostname)) {
  throw new Error("ZSSH_PLUGIN_DEMO_RECORDING_URL must use a public hostname");
}
const reviewReadFile = required("ZSSH_REVIEW_FILE");
const reviewWriteFile = required("ZSSH_REVIEW_WRITE_FILE");
const challengeToken = String(process.env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim();

const origin = mcpUrl.origin;
const metadataUrl = protectedResourceMetadataUrl(mcpUrl);
const healthUrl = new URL("/health", origin);
const challengeUrl = new URL("/.well-known/openai-apps-challenge", origin);
const listingPages = [
  ["website", new URL("/", origin), ["Your Linux target stays yours."]],
  ["support", new URL("/support", origin), [
    "<h1>Support</h1>",
    'href="https://github.com/Zennay/zSSH/issues"',
    'href="https://github.com/Zennay/zSSH/security/advisories/new"',
  ]],
  ["privacy", new URL("/privacy", origin), ["<h1>Privacy</h1>"]],
  ["terms", new URL("/terms", origin), ["<h1>Terms</h1>"]],
];

const demoResponse = await fetch(demoRecordingUrl, {
  redirect: "follow",
  headers: {
    accept: "text/html,video/*;q=0.9,*/*;q=0.1",
    range: "bytes=0-0",
    "user-agent": "zssh-openai-submission-probe/1.0",
  },
  signal: AbortSignal.timeout(10000),
});
const demoFinalUrl = new URL(demoResponse.url || demoRecordingUrl.href);
if (!demoResponse.ok) {
  await demoResponse.body?.cancel().catch(() => {});
  throw new Error("demo recording URL is not reviewer-accessible: HTTP " + demoResponse.status);
}
if ((allowHttp ? !["http:", "https:"].includes(demoFinalUrl.protocol) : demoFinalUrl.protocol !== "https:") ||
    demoFinalUrl.username || demoFinalUrl.password ||
    (!allowHttp && isNonPublicHostname(demoFinalUrl.hostname))) {
  await demoResponse.body?.cancel().catch(() => {});
  throw new Error("demo recording redirected to a non-public or unsafe URL");
}
const demoContentType = demoResponse.headers.get("content-type") || "";
await demoResponse.body?.cancel().catch(() => {});

for (const [name, listingUrl, markers] of listingPages) {
  const response = await fetchNoRedirect(listingUrl, { headers: { accept: "text/html" } }, name + " listing page");
  if (!response.ok) throw new Error(name + " listing page failed: HTTP " + response.status);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    throw new Error(name + " listing page must return text/html");
  }
  const csp = response.headers.get("content-security-policy") || "";
  if (!/default-src\s+'none'/i.test(csp) || !/frame-ancestors\s+'none'/i.test(csp)) {
    throw new Error(name + " listing page is missing the restrictive CSP");
  }
  const body = await response.text();
  for (const marker of markers) {
    if (!body.includes(marker)) {
      throw new Error(name + " listing page did not return the expected zSSH content");
    }
  }
}

const health = await fetchNoRedirect(healthUrl, {}, "health endpoint");
if (!health.ok) throw new Error("health endpoint failed: HTTP " + health.status);

const metadataResponse = await fetchNoRedirect(metadataUrl, {}, "OAuth protected-resource metadata");
if (!metadataResponse.ok) throw new Error("OAuth protected-resource metadata failed: HTTP " + metadataResponse.status);
const metadata = await metadataResponse.json();
if (metadata.resource !== origin) {
  throw new Error("OAuth resource mismatch: expected " + origin + ", got " + metadata.resource);
}
if (!Array.isArray(metadata.authorization_servers) || metadata.authorization_servers.length < 1) {
  throw new Error("OAuth protected-resource metadata has no authorization server");
}
if (!Array.isArray(metadata.scopes_supported) || !metadata.scopes_supported.includes("zssh:read") || !metadata.scopes_supported.includes("zssh:write")) {
  throw new Error("OAuth protected-resource metadata is missing zssh:read/zssh:write");
}

const authorizationServerEvidence = [];
for (const issuer of metadata.authorization_servers) {
  const discovered = await fetchAuthorizationServerMetadata(issuer, {
    allowHttp,
    requirePublicHostname: !allowHttp,
  });
  authorizationServerEvidence.push({
    issuer: discovered.validated.issuer,
    metadata_url: discovered.url,
    authorization_endpoint: discovered.validated.authorization_endpoint,
    token_endpoint: discovered.validated.token_endpoint,
    registration_endpoint: discovered.validated.registration_endpoint,
    pkce_s256: discovered.validated.pkce_s256,
    authorization_code: discovered.validated.authorization_code,
    token_endpoint_auth_methods: discovered.validated.token_endpoint_auth_methods,
  });
}

const unauthenticated = await fetchNoRedirect(mcpUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
}, "unauthenticated MCP endpoint");
if (unauthenticated.status !== 401) {
  throw new Error("unauthenticated MCP request must return 401, got " + unauthenticated.status);
}
const challengeHeader = unauthenticated.headers.get("www-authenticate") || "";
assertExactBearerResourceMetadata(challengeHeader, metadataUrl);

if (challengeToken) {
  const verification = await fetchNoRedirect(challengeUrl, { cache: "no-store" }, "OpenAI domain challenge");
  const body = await verification.text();
  if (!verification.ok || body !== challengeToken) {
    throw new Error("OpenAI domain verification challenge does not match exactly");
  }
}

const client = new Client({ name: "zssh-production-submission-probe", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(mcpUrl, {
  requestInit: {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
  },
});

const requiredTools = [
  "get_profile",
  "get_pairing_status",
  "zssh_server_info",
  "get_system_uptime",
  "get_system_identity",
  "get_kernel_info",
  "get_disk_usage",
  "get_memory_usage",
  "zssh_read_file",
  "zssh_write_file",
];
const forbiddenTools = ["zssh_exec", "zssh_run_safe"];

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools || [];
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const toolScanSha256 = publicToolContractFingerprint(tools);

  for (const name of requiredTools) {
    if (!byName.has(name)) throw new Error("production scan is missing tool: " + name);
  }
  for (const name of forbiddenTools) {
    if (byName.has(name)) throw new Error("public production scan exposes forbidden generic tool: " + name);
  }

  assertPublicToolScopeContract(tools);

  for (const tool of tools) {
    const annotations = tool.annotations || {};
    for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      if (typeof annotations[key] !== "boolean") {
        throw new Error(tool.name + " lacks explicit annotation " + key);
      }
    }
  }

  const annotationJustifications = assertAnnotationJustificationsMatchTools(
    tools,
    await loadAnnotationJustifications(),
  );

  const profileTool = byName.get("get_profile");
  if (profileTool?._meta?.["openai/profile"] !== true) {
    throw new Error("get_profile is not marked as the OpenAI profile tool");
  }

  const writeTool = byName.get("zssh_write_file");
  if (writeTool?.annotations?.readOnlyHint !== false || writeTool?.annotations?.destructiveHint !== true) {
    throw new Error("zssh_write_file annotations are not fail-safe");
  }

  const pairingTool = byName.get("get_pairing_status");
  if (pairingTool?.annotations?.readOnlyHint !== false || pairingTool?.annotations?.destructiveHint !== false) {
    throw new Error("get_pairing_status annotations do not match its request-creation behavior");
  }

  const profileCall = await client.callTool({ name: "get_profile", arguments: {} });
  if (profileCall.isError) throw new Error("get_profile failed: " + textPart(profileCall));
  const profile = jsonResult(profileCall);
  if (!/^zssh_[a-f0-9]{32}$/.test(String(profile.id || ""))) {
    throw new Error("get_profile did not return a stable opaque zSSH profile id");
  }

  const pairingCall = await client.callTool({ name: "get_pairing_status", arguments: {} });
  if (pairingCall.isError) throw new Error("get_pairing_status failed: " + textPart(pairingCall));
  const pairing = jsonResult(pairingCall);
  if (pairing.paired !== true) {
    throw new Error("review OAuth profile is not locally paired to the production target");
  }

  const infoCall = await client.callTool({ name: "zssh_server_info", arguments: {} });
  if (infoCall.isError) throw new Error("zssh_server_info failed: " + textPart(infoCall));
  const info = jsonResult(infoCall);
  const serverPolicy = validateProductionServerInfo(info, {
    requireOutboundAgent: String(process.env.ZSSH_REQUIRE_OUTBOUND_AGENT || "").trim() === "1",
  });

  for (const name of ["get_system_uptime", "get_system_identity", "get_kernel_info", "get_disk_usage", "get_memory_usage"]) {
    const response = await client.callTool({ name, arguments: {} });
    if (response.isError) throw new Error(name + " failed: " + textPart(response));
    const value = jsonResult(response);
    if (value.ok !== true) throw new Error(name + " did not return ok=true");
  }

  const read = await client.callTool({ name: "zssh_read_file", arguments: { path: reviewReadFile } });
  if (read.isError) throw new Error("review read-file case failed: " + textPart(read));
  const readValue = jsonResult(read);
  if (!String(readValue.content || "").includes("zSSH reviewer fixture")) {
    throw new Error("review fixture content is missing");
  }

  const marker = "submission-probe-" + crypto.randomUUID();
  const write = await client.callTool({
    name: "zssh_write_file",
    arguments: { path: reviewWriteFile, content: marker + "\n" },
  });
  if (write.isError) throw new Error("review write-file case failed: " + textPart(write));

  const readBack = await client.callTool({ name: "zssh_read_file", arguments: { path: reviewWriteFile } });
  const readBackValue = jsonResult(readBack);
  if (readBack.isError || readBackValue.content !== marker + "\n") {
    throw new Error("review write/read roundtrip did not match");
  }

  console.log(JSON.stringify({
    ok: true,
    mcp_origin: origin,
    oauth_resource: metadata.resource,
    authorization_servers: metadata.authorization_servers,
    domain_challenge_checked: Boolean(challengeToken),
    demo_recording_accessible: true,
    demo_recording_origin: demoFinalUrl.origin,
    demo_recording_path: demoFinalUrl.pathname,
    demo_recording_content_type: demoContentType,
    no_redirect_contract_validated: true,
    listing_urls_validated: true,
    support_contact_routes_validated: true,
    listing_paths: listingPages.map(([, listingUrl]) => listingUrl.pathname),
    exact_resource_metadata_challenge_validated: true,
    tool_count: tools.length,
    tool_scan_sha256: toolScanSha256,
    forbidden_generic_tools_absent: true,
    annotations_validated: true,
    annotation_justifications_validated: true,
    annotation_justifications_sha256: annotationJustifications.sha256,
    oauth_security_validated: true,
    oauth_tool_scope_contract_validated: true,
    oauth_authorization_server_metadata_validated: true,
    oauth_pkce_s256_validated: authorizationServerEvidence.every(item => item.pkce_s256 === true),
    oauth_authorization_servers: authorizationServerEvidence,
    profile_id_shape_validated: true,
    paired_review_identity: true,
    public_metadata_minimized: true,
    outbound_agent_transport_validated: serverPolicy.outbound_agent_transport_validated,
    read_only_system_tools_green: true,
    review_file_read_green: true,
    review_file_write_roundtrip_green: true,
  }, null, 2));
} finally {
  await client.close().catch(() => {});
}
