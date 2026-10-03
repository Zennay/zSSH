import { runSafeProgram, readTextFile, writeTextFile } from "./server.mjs";
import { VERSION } from "./version.mjs";

const PUBLIC_PROGRAMS = Object.freeze({
  get_system_uptime: ["uptime", []],
  get_system_identity: ["id", []],
  get_kernel_info: ["uname", ["-a"]],
  get_disk_usage: ["df", ["-h"]],
  get_memory_usage: ["free", ["-h"]],
});

function argsObject(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent command args must be an object");
  }
  return value;
}

export async function executeAgentCommand(command, { targetLabel = process.env.ZSSH_TARGET_LABEL || "Linux target" } = {}) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("agent command must be an object");
  }
  const tool = String(command.tool || "").trim();
  const args = argsObject(command.args);

  if (tool === "zssh_server_info") {
    return {
      ok: true,
      version: VERSION,
      target_label: String(targetLabel).slice(0, 80),
      platform: process.platform,
      arch: process.arch,
      exec_mode: "disabled",
      transport: "outbound-agent",
    };
  }

  if (tool === "zssh_read_file") {
    if (typeof args.path !== "string" || !args.path) throw new Error("path is required");
    return { ok: true, ...(await readTextFile(args.path, { rejectSecrets: true })) };
  }

  if (tool === "zssh_write_file") {
    if (typeof args.path !== "string" || !args.path) throw new Error("path is required");
    if (typeof args.content !== "string") throw new Error("content must be a string");
    return { ok: true, ...(await writeTextFile(args.path, args.content, { rejectSecrets: true })) };
  }

  const fixed = PUBLIC_PROGRAMS[tool];
  if (fixed) {
    const value = await runSafeProgram(fixed[0], fixed[1]);
    return value;
  }

  throw new Error("tool is not exposed through the public outbound agent");
}
