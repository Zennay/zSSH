import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { verifyClientToken } from "./auth-store.mjs";

const VERSION = "0.2.0";
const PORT = Number(process.env.PORT || 8788);
const PROFILE = process.env.ZSSH_PROFILE === "plugin" ? "plugin" : "private";
const EXEC_MODE = process.env.ZSSH_EXEC_MODE === "full" ? "full" : "disabled";
const COMMAND_TIMEOUT_SECONDS = clampInt(process.env.ZSSH_COMMAND_TIMEOUT_SECONDS, 1, 300, 30);
const MAX_OUTPUT_BYTES = clampInt(process.env.ZSSH_MAX_OUTPUT_BYTES, 4096, 1048576, 131072);
const MAX_FILE_BYTES = clampInt(process.env.ZSSH_MAX_FILE_BYTES, 1024, 1048576, 131072);
const DEV_TOKEN = process.env.ZSSH_DEV_BEARER_TOKEN || "";
const API_KEY = process.env.ZSSH_API_KEY || "";
const CAPABILITY_TOKEN = process.env.ZSSH_MCP_CAPABILITY_TOKEN || "";
const TRUST_LOCAL_TUNNEL = process.env.ZSSH_TRUST_LOCAL_TUNNEL === "1";
const TARGET_NAME = (process.env.ZSSH_TARGET_NAME || os.hostname()).trim().slice(0, 128) || os.hostname();
const FALLBACK_TARGET_ID = "target_" + crypto
  .createHash("sha256")
  .update(os.hostname() + ":" + String(typeof process.getuid === "function" ? process.getuid() : "unknown"))
  .digest("hex")
  .slice(0, 24);
const TARGET_ID = (process.env.ZSSH_TARGET_ID || FALLBACK_TARGET_ID).trim().slice(0, 128);
const AUDIT_LOG = path.resolve(process.env.ZSSH_AUDIT_LOG || "./data/audit.jsonl");
const CLIENT_TOKEN_AUTH_CONFIGURED = Boolean(process.env.ZSSH_CLIENT_TOKENS_FILE);
const SAFE_PROGRAM_PATHS = Object.freeze({
  uptime: "/usr/bin/uptime",
  whoami: "/usr/bin/whoami",
  id: "/usr/bin/id",
  uname: "/usr/bin/uname",
  pwd: "/usr/bin/pwd",
  df: "/usr/bin/df",
  free: "/usr/bin/free"
});
const SAFE_PROGRAM_NAMES = Object.freeze(Object.keys(SAFE_PROGRAM_PATHS));
const GIT_BIN = process.env.ZSSH_GIT_BIN || "/usr/bin/git";
const SYSTEMCTL_BIN = process.env.ZSSH_SYSTEMCTL_BIN || "/usr/bin/systemctl";

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function redactSecrets(input) {
  let text = String(input ?? "");
  text = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]");
  text = text.replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*([^\s"'\\]+)/gi, "$1=[REDACTED]");
  text = text.replace(/\bzssh_[0-9a-f]{16}_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_ZSSH_TOKEN]");
  return text;
}

export function classifyCommand(command) {
  const raw = String(command || "").trim();
  const c = raw.toLowerCase();

  const destructive = [
    /(^|[;&|]\s*)rm\s+(-[^\n]*r[^\n]*f|-rf|-fr)\b/,
    /(^|[;&|]\s*)mkfs(\.|\s)/,
    /(^|[;&|]\s*)dd\s+if=/,
    /(^|[;&|]\s*)(shutdown|reboot|poweroff|halt)\b/,
    /systemctl\s+(stop|disable|mask)\b/,
    /git\s+(reset\s+--hard|clean\s+-[^\n]*f)/,
    /(^|[;&|]\s*)(fdisk|parted|wipefs)\b/
  ];
  if (destructive.some(re => re.test(c))) return "destructive";

  const readOnly = [
    /^(pwd|whoami|id|uname|uptime|hostname|date)(\s|$)/,
    /^(df|free|ps|ls|stat|find|grep|rg|head|tail|cat|wc)(\s|$)/,
    /^git\s+(status|log|show|diff|branch)(\s|$)/,
    /^systemctl\s+(status|is-active|is-enabled|show|list-units)(\s|$)/,
    /^journalctl(\s|$)/
  ];
  if (readOnly.some(re => re.test(c))) return "read_only";
  return "mutation";
}

function getAllowedRoots() {
  const raw = process.env.ZSSH_ALLOWED_ROOTS || process.cwd();
  return raw.split(",").map(v => path.resolve(v.trim())).filter(Boolean);
}

function getAllowedServices() {
  const raw = process.env.ZSSH_ALLOWED_SERVICES || "";
  return [...new Set(raw.split(",").map(v => v.trim()).filter(Boolean))]
    .filter(name => /^[A-Za-z0-9@_.:-]{1,128}$/.test(name));
}

function getEnabledSafePrograms() {
  const raw = process.env.ZSSH_SAFE_PROGRAMS || SAFE_PROGRAM_NAMES.join(",");
  const requested = raw.split(",").map(v => v.trim()).filter(Boolean);
  return [...new Set(requested)].filter(name => Object.hasOwn(SAFE_PROGRAM_PATHS, name));
}

function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function resolveAllowedPath(inputPath, { forWrite = false } = {}) {
  if (!inputPath || typeof inputPath !== "string") throw new Error("path is required");
  const requested = path.resolve(inputPath);
  const roots = [];
  for (const configured of getAllowedRoots()) {
    try {
      roots.push(await fs.realpath(configured));
    } catch {
      // An unavailable configured root is ignored, not implicitly created.
    }
  }
  if (!roots.length) throw new Error("no valid ZSSH_ALLOWED_ROOTS configured");

  let checked;
  if (forWrite) {
    const parentReal = await fs.realpath(path.dirname(requested));
    checked = path.join(parentReal, path.basename(requested));
  } else {
    checked = await fs.realpath(requested);
  }

  if (!roots.some(root => isWithin(root, checked))) {
    throw new Error("path is outside allowed roots");
  }
  return checked;
}

function safeEnvironment() {
  const keys = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "SHELL"];
  return Object.fromEntries(keys.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
}

async function audit(event) {
  const safeEvent = {
    ts: new Date().toISOString(),
    target_id: TARGET_ID,
    ...event
  };
  if (safeEvent.command) safeEvent.command = redactSecrets(safeEvent.command);
  if (safeEvent.args) safeEvent.args = safeEvent.args.map(redactSecrets);
  await fs.mkdir(path.dirname(AUDIT_LOG), { recursive: true, mode: 0o700 });
  await fs.appendFile(AUDIT_LOG, JSON.stringify(safeEvent) + "\n", { encoding: "utf8", mode: 0o600 });
}

async function runFixedProgram(executable, args, cwd, action, timeoutSeconds = COMMAND_TIMEOUT_SECONDS) {
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== "string" || arg.length > 1024)) {
    throw new Error("invalid program arguments");
  }
  const resolvedCwd = await resolveAllowedPath(cwd || getAllowedRoots()[0] || process.cwd());
  const timeoutMs = clampInt(timeoutSeconds, 1, 300, COMMAND_TIMEOUT_SECONDS) * 1000;
  const startedAt = Date.now();

  return await new Promise(resolve => {
    const child = spawn(executable, args, {
      cwd: resolvedCwd,
      env: safeEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let limited = false;
    let timedOut = false;
    let settled = false;

    const append = (target, chunk) => {
      const next = Buffer.concat([target, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        limited = true;
        return next.subarray(0, MAX_OUTPUT_BYTES);
      }
      return next;
    };

    child.stdout.on("data", chunk => {
      stdout = append(stdout, chunk);
      if (limited) child.kill("SIGTERM");
    });
    child.stderr.on("data", chunk => {
      stderr = append(stderr, chunk);
      if (limited) child.kill("SIGTERM");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);

    const finish = async payload => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const value = {
        ...payload,
        timed_out: timedOut,
        output_limited: limited,
        duration_ms: durationMs,
        stdout: redactSecrets(stdout.toString("utf8")),
        stderr: redactSecrets(stderr.toString("utf8"))
      };
      try {
        await audit({
          action,
          executable,
          args,
          cwd: resolvedCwd,
          outcome: value.ok ? "ok" : "error",
          exit_code: value.exit_code,
          timed_out: timedOut,
          output_limited: limited,
          duration_ms: durationMs
        });
      } catch {
        // Never turn an operation result into a secret-bearing audit error.
      }
      resolve(value);
    };

    child.on("error", err => finish({ ok: false, exit_code: null, error: err.message }));
    child.on("close", (code, signal) => finish({
      ok: code === 0 && !timedOut && !limited,
      exit_code: code,
      signal: signal || null,
      error: timedOut ? "program timed out" : limited ? "output limit exceeded" : code === 0 ? null : "program exited non-zero"
    }));
  });
}

export async function runSafeProgram(program, args = [], cwd, timeoutSeconds) {
  const name = String(program || "").trim();
  const enabled = getEnabledSafePrograms();

  if (!enabled.includes(name)) {
    await audit({ action: "run_safe", program: name, args: Array.isArray(args) ? args : [], outcome: "blocked" });
    return {
      ok: false,
      blocked: true,
      program: name,
      error: "program is not in the zSSH safe allowlist"
    };
  }

  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== "string" || arg.length > 512)) {
    throw new Error("args must contain at most 32 strings of at most 512 characters");
  }

  const value = await runFixedProgram(SAFE_PROGRAM_PATHS[name], args, cwd, "run_safe", timeoutSeconds);
  return { ...value, program: name };
}

async function execute(command, cwd, timeoutSeconds) {
  const risk = classifyCommand(command);
  if (EXEC_MODE !== "full") {
    await audit({ action: "exec", risk, outcome: "blocked", command, cwd });
    return {
      ok: false,
      blocked: true,
      risk,
      error: "raw shell is disabled by default; enable ZSSH_EXEC_MODE=full only for an explicitly trusted/disposable target"
    };
  }

  const resolvedCwd = await resolveAllowedPath(cwd || getAllowedRoots()[0] || process.cwd());
  const timeoutMs = clampInt(timeoutSeconds, 1, 300, COMMAND_TIMEOUT_SECONDS) * 1000;
  const startedAt = Date.now();

  return await new Promise(resolve => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd: resolvedCwd,
      env: safeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let limited = false;
    let timedOut = false;
    let settled = false;

    const append = (target, chunk) => {
      const next = Buffer.concat([target, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        limited = true;
        return next.subarray(0, MAX_OUTPUT_BYTES);
      }
      return next;
    };

    child.stdout.on("data", chunk => {
      stdout = append(stdout, chunk);
      if (limited) child.kill("SIGTERM");
    });
    child.stderr.on("data", chunk => {
      stderr = append(stderr, chunk);
      if (limited) child.kill("SIGTERM");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);

    const finish = async payload => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const value = {
        ...payload,
        risk,
        timed_out: timedOut,
        output_limited: limited,
        duration_ms: durationMs,
        stdout: redactSecrets(stdout.toString("utf8")),
        stderr: redactSecrets(stderr.toString("utf8"))
      };
      try {
        await audit({
          action: "exec",
          risk,
          outcome: value.ok ? "ok" : "error",
          command,
          cwd: resolvedCwd,
          exit_code: value.exit_code,
          timed_out: timedOut,
          output_limited: limited,
          duration_ms: durationMs
        });
      } catch {
        // Audit failure must not leak secrets into the tool response.
      }
      resolve(value);
    };

    child.on("error", err => finish({ ok: false, exit_code: null, error: err.message }));
    child.on("close", (code, signal) => finish({
      ok: code === 0 && !timedOut && !limited,
      exit_code: code,
      signal: signal || null,
      error: timedOut ? "command timed out" : limited ? "output limit exceeded" : code === 0 ? null : "command exited non-zero"
    }));
  });
}

async function readTextFile(filePath) {
  const resolved = await resolveAllowedPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("path is not a regular file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("file exceeds ZSSH_MAX_FILE_BYTES");
  const content = await fs.readFile(resolved, "utf8");
  await audit({ action: "read_file", path: resolved, bytes: stat.size, outcome: "ok" });
  return { path: resolved, bytes: stat.size, content: redactSecrets(content) };
}

async function listDirectory(directoryPath) {
  const resolved = await resolveAllowedPath(directoryPath || getAllowedRoots()[0]);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error("path is not a directory");
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const limited = entries.slice(0, 250).map(entry => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other"
  }));
  await audit({ action: "list_directory", path: resolved, entries: limited.length, outcome: "ok" });
  return { path: resolved, entries: limited, truncated: entries.length > limited.length };
}

async function writeTextFile(filePath, content) {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) throw new Error("content exceeds ZSSH_MAX_FILE_BYTES");
  const resolved = await resolveAllowedPath(filePath, { forWrite: true });
  const tmp = path.join(path.dirname(resolved), "." + path.basename(resolved) + ".zssh-" + crypto.randomUUID());
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(tmp, resolved);
  await audit({ action: "write_file", path: resolved, bytes, outcome: "ok" });
  return { path: resolved, bytes };
}

async function gitStatus(repoPath) {
  const resolved = await resolveAllowedPath(repoPath);
  return {
    repo: resolved,
    ...(await runFixedProgram(GIT_BIN, ["-C", resolved, "status", "--short", "--branch"], resolved, "git_status"))
  };
}

async function gitPull(repoPath) {
  const resolved = await resolveAllowedPath(repoPath);
  return {
    repo: resolved,
    ...(await runFixedProgram(GIT_BIN, ["-C", resolved, "pull", "--ff-only"], resolved, "git_pull"))
  };
}

function validateAllowedService(service) {
  const name = String(service || "").trim();
  if (!/^[A-Za-z0-9@_.:-]{1,128}$/.test(name)) throw new Error("invalid service name");
  const allowed = getAllowedServices();
  if (!allowed.includes(name)) {
    throw new Error("service is not in ZSSH_ALLOWED_SERVICES");
  }
  return name;
}

async function serviceStatus(service) {
  const name = validateAllowedService(service);
  return {
    service: name,
    ...(await runFixedProgram(
      SYSTEMCTL_BIN,
      ["--user", "show", name, "--property=Id,LoadState,ActiveState,SubState", "--no-pager"],
      getAllowedRoots()[0],
      "service_status"
    ))
  };
}

async function restartService(service) {
  const name = validateAllowedService(service);
  return {
    service: name,
    ...(await runFixedProgram(
      SYSTEMCTL_BIN,
      ["--user", "restart", name],
      getAllowedRoots()[0],
      "restart_service"
    ))
  };
}

function result(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError
  };
}

function structuredResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError
  };
}

function createMcpServer() {
  const pluginMode = PROFILE === "plugin";
  const server = new McpServer(
    { name: "zssh", version: VERSION },
    {
      instructions: pluginMode
        ? "zSSH operates one self-hosted Linux target. Use explicit bounded tools only. Prefer read-only inspection first. Never request or echo credentials, private keys, tokens, or passwords."
        : "zSSH operates one private self-hosted Linux target. Prefer read-only inspection first. Raw shell may exist only in private mode and remains disabled unless the operator explicitly enables it. Never request or echo credentials, private keys, tokens, or passwords."
    }
  );

  server.registerTool(
    "zssh_get_profile",
    {
      title: "Connected zSSH target",
      description: "Return the stable identity of the self-hosted Linux target represented by this authenticated zSSH connection.",
      inputSchema: {},
      outputSchema: {
        id: z.string(),
        name: z.string(),
        nickname: z.string()
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { "openai/profile": true }
    },
    async () => structuredResult({
      id: TARGET_ID,
      name: "zSSH Linux target",
      nickname: TARGET_NAME
    })
  );

  server.registerTool(
    "zssh_server_info",
    {
      title: "Server info",
      description: "Read basic identity and zSSH policy state for the connected Linux target.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => result({
      version: VERSION,
      target_id: TARGET_ID,
      target_name: TARGET_NAME,
      profile: PROFILE,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      uid: typeof process.getuid === "function" ? process.getuid() : null,
      exec_mode: EXEC_MODE,
      safe_programs: pluginMode ? [] : getEnabledSafePrograms(),
      allowed_roots: getAllowedRoots(),
      allowed_services: getAllowedServices(),
      timeout_seconds: COMMAND_TIMEOUT_SECONDS,
      max_output_bytes: MAX_OUTPUT_BYTES
    })
  );

  server.registerTool(
    "zssh_list_directory",
    {
      title: "List directory",
      description: "List up to 250 direct entries in a directory inside configured zSSH allowed roots.",
      inputSchema: { path: z.string().min(1).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path: directoryPath }) => {
      try {
        return result(await listDirectory(directoryPath));
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file inside configured zSSH allowed roots. Secret-like values are redacted.",
      inputSchema: { path: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path: filePath }) => {
      try {
        return result(await readTextFile(filePath));
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_git_status",
    {
      title: "Git status",
      description: "Read concise Git branch and working-tree status for a repository inside configured zSSH allowed roots.",
      inputSchema: { path: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path: repoPath }) => {
      try {
        const value = await gitStatus(repoPath);
        return result(value, !value.ok);
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_git_pull",
    {
      title: "Git fast-forward pull",
      description: "Update one Git repository inside configured zSSH allowed roots using git pull --ff-only. The tool will not create a merge commit.",
      inputSchema: { path: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ path: repoPath }) => {
      try {
        const value = await gitPull(repoPath);
        return result(value, !value.ok);
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_service_status",
    {
      title: "Service status",
      description: "Read status for one explicitly allowlisted user-level systemd service.",
      inputSchema: { service: z.string().min(1).max(128) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ service }) => {
      try {
        const value = await serviceStatus(service);
        return result(value, !value.ok);
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_restart_service",
    {
      title: "Restart service",
      description: "Restart one explicitly allowlisted user-level systemd service. Other services cannot be targeted.",
      inputSchema: { service: z.string().min(1).max(128) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ service }) => {
      try {
        const value = await restartService(service);
        return result(value, !value.ok);
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  if (!pluginMode) {
    server.registerTool(
      "zssh_write_file",
      {
        title: "Write file",
        description: "Atomically replace or create a UTF-8 text file inside configured zSSH allowed roots.",
        inputSchema: {
          path: z.string().min(1),
          content: z.string()
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      },
      async ({ path: filePath, content }) => {
        try {
          return result({ ok: true, ...(await writeTextFile(filePath, content)) });
        } catch (err) {
          return result({ ok: false, error: String(err?.message || err) }, true);
        }
      }
    );

    server.registerTool(
      "zssh_run_safe",
      {
        title: "Run safe program",
        description: "Run one hard-allowlisted read-only Linux program without a shell. Arguments are passed directly as argv and are never shell-interpreted.",
        inputSchema: {
          program: z.enum(SAFE_PROGRAM_NAMES),
          args: z.array(z.string().max(512)).max(32).optional(),
          cwd: z.string().min(1).optional(),
          timeout_seconds: z.number().int().min(1).max(300).optional()
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      async ({ program, args, cwd, timeout_seconds }) => {
        try {
          const value = await runSafeProgram(program, args || [], cwd, timeout_seconds);
          return result(value, !value.ok);
        } catch (err) {
          return result({ ok: false, error: String(err?.message || err) }, true);
        }
      }
    );

    server.registerTool(
      "zssh_exec",
      {
        title: "Execute command",
        description: "Run one bounded shell command on the connected Linux target. This tool exists only in private profile and raw shell must also be explicitly enabled.",
        inputSchema: {
          command: z.string().min(1).max(4096),
          cwd: z.string().min(1).optional(),
          timeout_seconds: z.number().int().min(1).max(300).optional()
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      },
      async ({ command, cwd, timeout_seconds }) => {
        try {
          const value = await execute(command, cwd, timeout_seconds);
          return result(value, !value.ok);
        } catch (err) {
          return result({ ok: false, error: String(err?.message || err) }, true);
        }
      }
    );
  }

  return server;
}

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function secureEqual(actual, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(actual || ""));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function staticCapabilityAuthorized(pathname) {
  return Boolean(CAPABILITY_TOKEN) && secureEqual(pathname, "/mcp/" + CAPABILITY_TOKEN);
}

function capabilityTokenFromPath(pathname) {
  if (!pathname.startsWith("/mcp/")) return "";
  const token = pathname.slice("/mcp/".length);
  return token && !token.includes("/") ? token : "";
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function authorized(req, pathname) {
  if (TRUST_LOCAL_TUNNEL && isLoopbackRequest(req)) return true;
  if (staticCapabilityAuthorized(pathname)) return true;
  if (secureEqual(req.headers["x-zssh-key"], API_KEY)) return true;
  if (secureEqual(req.headers.authorization, DEV_TOKEN ? "Bearer " + DEV_TOKEN : "")) return true;

  const candidates = [
    capabilityTokenFromPath(pathname),
    String(req.headers["x-zssh-key"] || ""),
    bearerToken(req)
  ].filter(Boolean);

  for (const token of candidates) {
    try {
      if (await verifyClientToken(token)) return true;
    } catch {
      // A missing/corrupt optional token store does not weaken auth.
    }
  }

  return !API_KEY && !DEV_TOKEN && !CAPABILITY_TOKEN && !CLIENT_TOKEN_AUTH_CONFIGURED && process.env.NODE_ENV !== "production";
}

function isMcpPath(pathname) {
  return pathname === "/mcp" || /^\/mcp\/[^/]+$/.test(pathname);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ZSSH_ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-zssh-key, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

export function start() {
  if (typeof process.getuid === "function" && process.getuid() === 0 && process.env.ZSSH_ALLOW_ROOT !== "1") {
    throw new Error("zSSH refuses to run as root; use a dedicated unprivileged service account");
  }
  if (
    process.env.NODE_ENV === "production" &&
    !CAPABILITY_TOKEN &&
    !API_KEY &&
    !DEV_TOKEN &&
    !CLIENT_TOKEN_AUTH_CONFIGURED &&
    !TRUST_LOCAL_TUNNEL
  ) {
    throw new Error("production requires authentication; configure revocable client tokens, a capability token, ZSSH_API_KEY, a bearer token, or explicitly trust the loopback tunnel");
  }

  const httpServer = createServer(async (req, res) => {
    if (!req.url) return res.writeHead(400).end("Missing URL");
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (req.method === "GET" && url.pathname === "/health") {
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true, service: "zssh", version: VERSION, profile: PROFILE, target: TARGET_NAME }));
    }

    if (!isMcpPath(url.pathname)) return res.writeHead(404).end("Not Found");
    cors(res);

    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (!(await authorized(req, url.pathname))) {
      return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    }

    if (!["POST", "GET", "DELETE"].includes(req.method || "")) return res.writeHead(405).end("Method Not Allowed");

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("zSSH MCP request failed:", err);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
  });

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log("zSSH listening on http://127.0.0.1:" + PORT + "/mcp (" + PROFILE + ")");
  });
  return httpServer;
}

export function isMainEntry(entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  }
}

if (isMainEntry()) {
  start();
}
