import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.ZSSH_MCP_URL || `http://127.0.0.1:${process.env.PORT || 8788}/mcp`;
const token = process.env.ZSSH_MCP_TOKEN || process.env.ZSSH_DEV_BEARER_TOKEN || "";

if (!token) throw new Error("ZSSH_MCP_TOKEN or ZSSH_DEV_BEARER_TOKEN is required");

const client = new Client({ name: "zssh-claude-compat", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
    },
  },
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
    endpoint: url,
    tool_count: names.size,
    tools: [...names].sort(),
    uid: info.uid,
    exec_mode: info.exec_mode,
  }));
} finally {
  await client.close().catch(() => {});
}
