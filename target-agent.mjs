#!/usr/bin/env node
import {
  TargetAgentHttpClient,
  loadAgentPrivateKey,
  runTargetAgentForever,
} from "./target-agent-client.mjs";
import { normalizeTargetId } from "./pairing.mjs";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  throw new Error("zSSH target agent refuses to run as root");
}

const targetId = normalizeTargetId(requiredEnv("ZSSH_TARGET_ID"));
if (targetId === "local") {
  throw new Error("zSSH outbound target agent requires an explicit opaque zt_ target id");
}
const gatewayUrl = requiredEnv("ZSSH_AGENT_GATEWAY_URL");
const privateKeyFile = requiredEnv("ZSSH_AGENT_PRIVATE_KEY_FILE");
if (!String(process.env.ZSSH_PUBLIC_ALLOWED_ROOTS || "").trim()) {
  throw new Error("ZSSH_PUBLIC_ALLOWED_ROOTS is required for outbound public target execution");
}

// The local executor must use the same public-profile filesystem policy as the
// reviewed MCP surface. Set this before dynamically importing server.mjs.
process.env.ZSSH_PLUGIN_PROFILE = "public";
process.env.ZSSH_EXEC_MODE = "disabled";

const privateKey = await loadAgentPrivateKey(privateKeyFile);
const {
  readTextFile,
  runSafeProgram,
  writeTextFile,
} = await import("./server.mjs");

async function executeTool(tool, args) {
  switch (tool) {
    case "get_system_uptime":
      return runSafeProgram("uptime", []);
    case "get_system_identity":
      return runSafeProgram("id", []);
    case "get_kernel_info":
      return runSafeProgram("uname", ["-a"]);
    case "get_disk_usage":
      return runSafeProgram("df", ["-h"]);
    case "get_memory_usage":
      return runSafeProgram("free", ["-h"]);
    case "zssh_read_file":
      return readTextFile(String(args?.path || ""), { rejectSecrets: true });
    case "zssh_write_file":
      return {
        ok: true,
        ...(await writeTextFile(
          String(args?.path || ""),
          String(args?.content ?? ""),
          { rejectSecrets: true },
        )),
      };
    default:
      throw new Error("target command is not in the public capability allowlist");
  }
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => controller.abort());
}

function eventLog(event) {
  const safe = {
    type: event?.type || "event",
    target_id: targetId,
  };
  if (event?.tool) safe.tool = event.tool;
  if (event?.request_id) safe.request_id = event.request_id;
  // Deliberately omit error text, request args, command results, nonces,
  // signatures, paths, credentials, and environment values from process logs.
  console.log(JSON.stringify(safe));
}

await runTargetAgentForever({
  createClient: async () => new TargetAgentHttpClient({
    gatewayUrl,
    targetId,
    privateKey,
    allowHttpLoopback:
      process.env.NODE_ENV !== "production" &&
      process.env.ZSSH_AGENT_ALLOW_HTTP_LOOPBACK === "1",
  }),
  executeTool,
  signal: controller.signal,
  reconnectDelayMs: 2000,
  maxReconnectDelayMs: 30000,
  onEvent: eventLog,
});
