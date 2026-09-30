import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.ZSSH_MCP_URL || `http://127.0.0.1:${process.env.PORT || 8788}/mcp`;
const capabilityToken = process.env.ZSSH_MCP_CLIENT_TOKEN || process.env.ZSSH_MCP_CAPABILITY_TOKEN || "";
const apiKey = process.env.ZSSH_MCP_API_KEY || process.env.ZSSH_API_KEY || "";
const token = process.env.ZSSH_MCP_TOKEN || process.env.ZSSH_DEV_BEARER_TOKEN || "";

if (!capabilityToken && !apiKey && !token) {
  throw new Error("A revocable client token, legacy capability token, API key, or bearer token is required");
}

let url = baseUrl;
if (capabilityToken) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  if (basePath === "/mcp") parsed.pathname = "/mcp/" + capabilityToken;
  url = parsed.href;
}

const headers = {
  Accept: "application/json, text/event-stream",
};
if (!capabilityToken && apiKey) headers["x-zssh-key"] = apiKey;
else if (!capabilityToken) headers.Authorization = `Bearer ${token}`;

const client = new Client({ name: "zssh-claude-compat", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
});

const displayEndpoint = capabilityToken
  ? (() => {
      const parsed = new URL(baseUrl);
      parsed.pathname = "/mcp/[REDACTED]";
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    })()
  : url;

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set((listed.tools || []).map((tool) => tool.name));
  const alwaysRequired = [
    "zssh_get_profile",
    "zssh_server_info",
    "zssh_list_directory",
    "zssh_read_file",
    "zssh_git_status",
    "zssh_git_pull",
    "zssh_service_status",
    "zssh_restart_service",
  ];
  let missing = alwaysRequired.filter((name) => !names.has(name));

  const infoResult = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const infoText = infoResult.content?.find((part) => part.type === "text")?.text;
  const info = JSON.parse(infoText || "{}");
  if (info.uid === 0) throw new Error("zSSH is running as root");

  if (info.profile === "private") {
    const privateRequired = ["zssh_run_safe", "zssh_write_file", "zssh_exec"];
    missing = missing.concat(privateRequired.filter((name) => !names.has(name)));
  } else {
    for (const forbidden of ["zssh_run_safe", "zssh_write_file", "zssh_exec"]) {
      if (names.has(forbidden)) throw new Error(`private-only tool leaked into plugin profile: ${forbidden}`);
    }
  }
  if (missing.length) throw new Error(`missing MCP tools: ${missing.join(", ")}`);

  console.log(JSON.stringify({
    ok: true,
    compatible: "claude-mcp",
    auth: capabilityToken ? "capability-url" : apiKey ? "x-zssh-key" : "bearer",
    endpoint: displayEndpoint,
    tool_count: names.size,
    tools: [...names].sort(),
    uid: info.uid,
    profile: info.profile,
    exec_mode: info.exec_mode,
  }));
} finally {
  await client.close().catch(() => {});
}
