import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.ZSSH_MCP_URL || `http://127.0.0.1:${process.env.PORT || 8788}/mcp`;
const apiKey = process.env.ZSSH_MCP_API_KEY || process.env.ZSSH_API_KEY || "";
const token = process.env.ZSSH_MCP_TOKEN || process.env.ZSSH_DEV_BEARER_TOKEN || "";

if (!apiKey && !token) {
  throw new Error("ZSSH_MCP_API_KEY/ZSSH_API_KEY or ZSSH_MCP_TOKEN/ZSSH_DEV_BEARER_TOKEN is required");
}

const headers = {
  Accept: "application/json, text/event-stream",
};
if (apiKey) headers["x-zssh-key"] = apiKey;
else headers.Authorization = `Bearer ${token}`;

const client = new Client({ name: "zssh-claude-compat", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set((listed.tools || []).map((tool) => tool.name));
  const required = [
    "zssh_server_info",
    "zssh_run_safe",
    "zssh_read_file",
    "zssh_write_file",
    "zssh_exec",
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`missing MCP tools: ${missing.join(", ")}`);

  const infoResult = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const infoText = infoResult.content?.find((part) => part.type === "text")?.text;
  const info = JSON.parse(infoText || "{}");
  if (info.uid === 0) throw new Error("zSSH is running as root");

  console.log(JSON.stringify({
    ok: true,
    compatible: "claude-mcp",
    auth: apiKey ? "x-zssh-key" : "bearer",
    endpoint: url,
    tool_count: names.size,
    tools: [...names].sort(),
    uid: info.uid,
    exec_mode: info.exec_mode,
  }));
} finally {
  await client.close().catch(() => {});
}
