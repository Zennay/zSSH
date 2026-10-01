import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = Number(process.env.PORT || 8788);
const token = process.env.ZSSH_DEV_BEARER_TOKEN || "";
if (!token) throw new Error("ZSSH_DEV_BEARER_TOKEN is required for the public plugin canary");

const client = new Client({ name: "zssh-public-plugin-canary", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${port}/mcp`),
  {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  },
);

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const tools = listed.tools || [];
  const names = new Set(tools.map(tool => tool.name));

  const required = [
    "zssh_server_info",
    "get_profile",
    "get_pairing_status",
    "zssh_read_file",
    "zssh_write_file",
    "get_system_uptime",
    "get_system_identity",
    "get_kernel_info",
    "get_disk_usage",
    "get_memory_usage",
  ];
  for (const name of required) {
    if (!names.has(name)) throw new Error(`missing public plugin tool: ${name}`);
  }

  for (const forbidden of ["zssh_exec", "zssh_run_safe"]) {
    if (names.has(forbidden)) throw new Error(`unsafe generic tool exposed in public profile: ${forbidden}`);
  }

  for (const tool of tools) {
    const a = tool.annotations || {};
    for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      if (typeof a[key] !== "boolean") {
        throw new Error(`tool ${tool.name} is missing explicit boolean annotation ${key}`);
      }
    }
    const schemes = tool.securitySchemes || tool._meta?.securitySchemes || [];
    if (!schemes.some(scheme => scheme?.type === "oauth2" && Array.isArray(scheme.scopes) && scheme.scopes.length > 0)) {
      throw new Error(`tool ${tool.name} is missing an OAuth security scheme`);
    }
  }

  const profileTool = tools.find(tool => tool.name === "get_profile");
  if (profileTool?._meta?.["openai/profile"] !== true) {
    throw new Error("get_profile is not marked as the OpenAI profile tool");
  }

  const pairingTool = tools.find(tool => tool.name === "get_pairing_status");
  const connectionUiUri = pairingTool?._meta?.ui?.resourceUri;
  if (connectionUiUri !== "ui://zssh/connection-card-v1.html") {
    throw new Error("get_pairing_status is not linked to the connection UI resource");
  }

  const resources = await client.listResources();
  if (!(resources.resources || []).some(resource => resource.uri === connectionUiUri)) {
    throw new Error("connection UI resource is not advertised");
  }
  const uiResource = await client.readResource({ uri: connectionUiUri });
  const ui = (uiResource.contents || []).find(content => content.uri === connectionUiUri);
  if (ui?.mimeType !== "text/html;profile=mcp-app") {
    throw new Error("connection UI resource has the wrong MCP Apps MIME type");
  }
  if (!String(ui?.text || "").includes("Approval stays local to the Linux target.")) {
    throw new Error("connection UI does not explain the local approval boundary");
  }
  if (/<iframe\b/i.test(String(ui?.text || ""))) {
    throw new Error("connection UI must not embed third-party frames");
  }
  const csp = ui?._meta?.ui?.csp || {};
  if ((csp.connectDomains || []).length || (csp.resourceDomains || []).length || (csp.frameDomains || []).length) {
    throw new Error("connection UI unexpectedly allows external origins");
  }

  const writeTool = tools.find(tool => tool.name === "zssh_write_file");
  if (writeTool?.annotations?.readOnlyHint !== false || writeTool?.annotations?.destructiveHint !== true) {
    throw new Error("write tool annotations are not fail-safe");
  }

  const infoResult = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const info = JSON.parse(infoResult.content?.find(part => part.type === "text")?.text || "{}");
  if (info.plugin_profile !== "public") throw new Error(`wrong plugin profile: ${info.plugin_profile}`);
  if (info.exec_mode !== "disabled") throw new Error(`raw shell is not disabled: ${info.exec_mode}`);
  if (info.auth_mode !== "legacy") throw new Error(`unexpected test auth mode: ${info.auth_mode}`);
  if (info.target_label !== "Linux target") throw new Error(`unexpected public target label: ${info.target_label}`);
  for (const forbidden of ["hostname", "uid", "allowed_roots", "safe_programs"]) {
    if (Object.hasOwn(info, forbidden)) throw new Error(`public server info leaks private field: ${forbidden}`);
  }

  for (const name of ["get_system_uptime", "get_system_identity"]) {
    const response = await client.callTool({ name, arguments: {} });
    const value = JSON.parse(response.content?.find(part => part.type === "text")?.text || "{}");
    if (!value.ok || !String(value.stdout || "").trim()) throw new Error(`${name} failed`);
  }

  const challenge = process.env.OPENAI_APPS_CHALLENGE_TOKEN || "";
  if (challenge) {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`);
    const body = await response.text();
    if (!response.ok || body !== challenge) throw new Error("OpenAI domain challenge response is not exact");
  }

  console.log(JSON.stringify({
    ok: true,
    profile: info.plugin_profile,
    raw_shell_exposed: false,
    annotations_validated: true,
    oauth_security_schemes_validated: true,
    connection_ui_validated: true,
    domain_challenge_validated: Boolean(challenge),
    tool_count: names.size,
  }));
} finally {
  await client.close().catch(() => {});
}
