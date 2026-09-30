import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const port = Number(process.env.PORT || 8788);
const token = process.env.ZSSH_DEV_BEARER_TOKEN || "";
if (!token) throw new Error("ZSSH_DEV_BEARER_TOKEN is required for the plugin canary");

const client = new Client({ name: "zssh-plugin-canary", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${port}/mcp`),
  { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
);

let canaryDirectory;
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set((listed.tools || []).map(tool => tool.name));

  const required = [
    "zssh_get_profile",
    "zssh_server_info",
    "zssh_list_directory",
    "zssh_read_file",
    "zssh_git_status",
    "zssh_git_pull",
    "zssh_service_status",
    "zssh_restart_service"
  ];
  for (const name of required) {
    if (!names.has(name)) throw new Error(`missing plugin-safe MCP tool: ${name}`);
  }

  for (const forbidden of ["zssh_exec", "zssh_run_safe", "zssh_write_file"]) {
    if (names.has(forbidden)) throw new Error(`private-only MCP tool leaked into plugin profile: ${forbidden}`);
  }

  const profileResult = await client.callTool({ name: "zssh_get_profile", arguments: {} });
  const profile = profileResult.structuredContent || JSON.parse(
    profileResult.content?.find(part => part.type === "text")?.text || "{}"
  );
  if (!profile.id || !profile.nickname) throw new Error("target profile is incomplete");

  const infoResult = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const info = JSON.parse(infoResult.content?.find(part => part.type === "text")?.text || "{}");
  if (info.uid === 0) throw new Error("zSSH is running as root");
  if (info.profile !== "plugin") throw new Error(`expected plugin profile, got ${info.profile}`);
  if (info.exec_mode !== "disabled") throw new Error("plugin canary requires fail-closed raw shell");

  const allowedRoot = info.allowed_roots?.[0];
  if (!allowedRoot || !path.isAbsolute(allowedRoot)) throw new Error("missing absolute allowed root");

  canaryDirectory = await mkdtemp(path.join(allowedRoot, ".zssh-plugin-canary-"));
  const file = path.join(canaryDirectory, "read-proof.txt");
  const expected = `zssh-plugin-canary-${crypto.randomUUID()}\n`;
  await writeFile(file, expected, { mode: 0o600 });

  const listedDirectory = JSON.parse((await client.callTool({
    name: "zssh_list_directory",
    arguments: { path: canaryDirectory }
  })).content?.find(part => part.type === "text")?.text || "{}");
  if (!listedDirectory.entries?.some(entry => entry.name === "read-proof.txt")) {
    throw new Error("directory listing canary failed");
  }

  const read = JSON.parse((await client.callTool({
    name: "zssh_read_file",
    arguments: { path: file }
  })).content?.find(part => part.type === "text")?.text || "{}");
  if (read.content !== expected) throw new Error("plugin read canary failed");

  const outside = await client.callTool({ name: "zssh_read_file", arguments: { path: "/etc/hosts" } });
  if (!outside.isError) throw new Error("outside-root read was accepted");

  console.log(JSON.stringify({
    ok: true,
    service: "zssh",
    profile: info.profile,
    target_id: profile.id,
    private_tools_hidden: true,
    file_read: true,
    directory_list: true,
    outside_root_blocked: true,
    tool_count: names.size
  }));
} finally {
  if (canaryDirectory) await rm(canaryDirectory, { recursive: true, force: true }).catch(() => {});
  await client.close().catch(() => {});
}
