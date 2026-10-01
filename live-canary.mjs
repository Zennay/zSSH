import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { VERSION } from "./version.mjs";

const port = Number(process.env.PORT || 8788);
const token = process.env.ZSSH_DEV_BEARER_TOKEN || "";
if (!token) throw new Error("ZSSH_DEV_BEARER_TOKEN is required for the live canary");

const client = new Client({ name: "zssh-live-canary", version: "1.0.0" });
let canaryDirectory;
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
  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  if (!healthResponse.ok) throw new Error(`health check failed: HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.version !== VERSION) {
    throw new Error(`runtime health version mismatch: expected ${VERSION}, got ${health.version}`);
  }

  await client.connect(transport);

  const listed = await client.listTools();
  const names = new Set((listed.tools || []).map(tool => tool.name));
  for (const required of ["zssh_server_info", "zssh_run_safe", "zssh_read_file", "zssh_write_file", "zssh_exec"]) {
    if (!names.has(required)) throw new Error(`missing MCP tool: ${required}`);
  }

  const infoResult = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const infoText = infoResult.content?.find(part => part.type === "text")?.text;
  const info = JSON.parse(infoText || "{}");
  if (info.version !== VERSION) {
    throw new Error(`MCP server version mismatch: expected ${VERSION}, got ${info.version}`);
  }
  if (info.uid === 0) throw new Error("zSSH is running as root");
  if (info.exec_mode !== "disabled") throw new Error(`raw shell is not fail-closed: ${info.exec_mode}`);

  const safeResult = await client.callTool({
    name: "zssh_run_safe",
    arguments: { program: "whoami", args: [] },
  });
  const safeText = safeResult.content?.find(part => part.type === "text")?.text;
  const safe = JSON.parse(safeText || "{}");
  if (!safe.ok || !String(safe.stdout || "").trim()) throw new Error("safe execution canary failed");

  const blocked = JSON.parse((await client.callTool({
    name: "zssh_exec", arguments: { command: "whoami" },
  })).content?.find(part => part.type === "text")?.text || "{}");
  if (!blocked.blocked || blocked.ok !== false) throw new Error("raw shell is not blocked");

  const allowedRoot = info.allowed_roots?.[0];
  if (!allowedRoot || !path.isAbsolute(allowedRoot)) throw new Error("missing absolute allowed root");
  canaryDirectory = await mkdtemp(path.join(allowedRoot, ".zssh-canary-"));
  const file = path.join(canaryDirectory, "roundtrip.txt");
  const content = `zssh-canary-${crypto.randomUUID()}\n`;
  const written = JSON.parse((await client.callTool({
    name: "zssh_write_file", arguments: { path: file, content },
  })).content?.find(part => part.type === "text")?.text || "{}");
  if (!written.ok || written.path !== file || written.bytes !== Buffer.byteLength(content)) {
    throw new Error("allowed-root write canary failed");
  }
  const read = JSON.parse((await client.callTool({
    name: "zssh_read_file", arguments: { path: file },
  })).content?.find(part => part.type === "text")?.text || "{}");
  if (read.content !== content || read.path !== file) throw new Error("allowed-root read canary failed");

  const outside = await client.callTool({ name: "zssh_read_file", arguments: { path: "/etc/hosts" } });
  if (!outside.isError) throw new Error("outside-root read was accepted");

  console.log(JSON.stringify({
    ok: true,
    service: "zssh",
    version: VERSION,
    uid: info.uid,
    exec_mode: info.exec_mode,
    safe_program: safe.program,
    file_roundtrip: true,
    outside_root_blocked: true,
    raw_shell_blocked: true,
    tool_count: names.size,
  }));
} finally {
  if (canaryDirectory) await rm(canaryDirectory, { recursive: true, force: true }).catch(() => {});
  await client.close().catch(() => {});
}
