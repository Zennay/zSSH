import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs, realpathSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { bearerChallenge, oauthConfigFromEnv, protectedResourceMetadata, requireScopes, verifyOAuthAuthorizationHeader } from "./oauth.mjs";
import { getPairingStatus, profileIdFromAuth } from "./pairing.mjs";

const VERSION = "0.1.0";
const PORT = Number(process.env.PORT || 8788);
const EXEC_MODE = process.env.ZSSH_EXEC_MODE === "full" ? "full" : "disabled";
const COMMAND_TIMEOUT_SECONDS = clampInt(process.env.ZSSH_COMMAND_TIMEOUT_SECONDS, 1, 300, 30);
const MAX_OUTPUT_BYTES = clampInt(process.env.ZSSH_MAX_OUTPUT_BYTES, 4096, 1048576, 131072);
const MAX_FILE_BYTES = clampInt(process.env.ZSSH_MAX_FILE_BYTES, 1024, 1048576, 131072);
const DEV_TOKEN = process.env.ZSSH_DEV_BEARER_TOKEN || "";
const API_KEY = process.env.ZSSH_API_KEY || "";
const CAPABILITY_TOKEN = process.env.ZSSH_MCP_CAPABILITY_TOKEN || "";
const TRUST_LOCAL_TUNNEL = process.env.ZSSH_TRUST_LOCAL_TUNNEL === "1";
const PLUGIN_PROFILE = process.env.ZSSH_PLUGIN_PROFILE === "public" ? "public" : "private";
const OPENAI_APPS_CHALLENGE_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN || "";
const PUBLIC_AUTH_MODE = process.env.ZSSH_PUBLIC_AUTH_MODE === "legacy" ? "legacy" : "oauth";
const OAUTH_CONFIG = oauthConfigFromEnv();
const PAIRING_REQUIRED = PLUGIN_PROFILE === "public" && process.env.ZSSH_PAIRING_REQUIRED !== "0";
const TARGET_LABEL = String(process.env.ZSSH_TARGET_LABEL || "Linux target").trim().slice(0, 80) || "Linux target";
const CONNECTION_UI_URI = "ui://zssh/connection-card-v1.html";
const CONNECTION_UI_HTML = readFileSync(new URL("./ui/connection-card.html", import.meta.url), "utf8");
const AUDIT_LOG = path.resolve(process.env.ZSSH_AUDIT_LOG || "./data/audit.jsonl");
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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function redactSecrets(input) {
  let text = String(input ?? "");
  text = text.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]");
  text = text.replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*([^\s"'\\]+)/gi, "$1=[REDACTED]");
  return text;
}

export function containsCredentialLikeSecret(input) {
  const raw = String(input ?? "");
  return redactSecrets(raw) !== raw;
}

export function publicPathLooksSensitive(inputPath) {
  const normalized = String(inputPath || "").replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) || "";

  if (segments.some(segment => [".ssh", ".gnupg", ".aws", ".azure", ".kube"].includes(segment))) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if ([".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json"].includes(basename)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx)$/.test(basename)) return true;
  if (/(^|[-_.])(secret|secrets|credential|credentials|token|tokens|password|passwords)([-_.]|$)/.test(basename)) return true;
  return false;
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
  const publicRoots = PLUGIN_PROFILE === "public" ? String(process.env.ZSSH_PUBLIC_ALLOWED_ROOTS || "").trim() : "";
  const raw = publicRoots || process.env.ZSSH_ALLOWED_ROOTS || process.cwd();
  return raw.split(",").map(v => path.resolve(v.trim())).filter(Boolean);
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
    ...event
  };
  if (safeEvent.command) safeEvent.command = redactSecrets(safeEvent.command);
  await fs.mkdir(path.dirname(AUDIT_LOG), { recursive: true, mode: 0o700 });
  await fs.appendFile(AUDIT_LOG, JSON.stringify(safeEvent) + "\n", { encoding: "utf8", mode: 0o600 });
}


export async function runSafeProgram(program, args = [], cwd, timeoutSeconds) {
  const name = String(program || "").trim();
  const enabled = getEnabledSafePrograms();

  if (!enabled.includes(name)) {
    await audit({ action: "run_safe", program: name, args: Array.isArray(args) ? args.map(redactSecrets) : [], outcome: "blocked" });
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

  const resolvedCwd = await resolveAllowedPath(cwd || getAllowedRoots()[0] || process.cwd());
  const timeoutMs = clampInt(timeoutSeconds, 1, 300, COMMAND_TIMEOUT_SECONDS) * 1000;
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(SAFE_PROGRAM_PATHS[name], args, {
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

    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const value = {
        ...payload,
        program: name,
        timed_out: timedOut,
        output_limited: limited,
        duration_ms: durationMs,
        stdout: redactSecrets(stdout.toString("utf8")),
        stderr: redactSecrets(stderr.toString("utf8"))
      };

      try {
        await audit({
          action: "run_safe",
          program: name,
          args: args.map(redactSecrets),
          cwd: resolvedCwd,
          outcome: value.ok ? "ok" : "error",
          exit_code: value.exit_code,
          timed_out: timedOut,
          output_limited: limited,
          duration_ms: durationMs
        });
      } catch {
        // Audit failure must not leak secret-bearing arguments into the response.
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

  return await new Promise((resolve) => {
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

    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const result = {
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
          outcome: result.ok ? "ok" : "error",
          command,
          cwd: resolvedCwd,
          exit_code: result.exit_code,
          timed_out: timedOut,
          output_limited: limited,
          duration_ms: durationMs
        });
      } catch {
        // Audit failure must not leak secrets into the tool response.
      }
      resolve(result);
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

async function readTextFile(filePath, { rejectSecrets = false } = {}) {
  if (rejectSecrets && publicPathLooksSensitive(filePath)) {
    throw new Error("public plugin refuses secret or credential file paths");
  }
  const resolved = await resolveAllowedPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("path is not a regular file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("file exceeds ZSSH_MAX_FILE_BYTES");
  const content = await fs.readFile(resolved, "utf8");
  if (rejectSecrets && containsCredentialLikeSecret(content)) {
    throw new Error("public plugin refuses files that appear to contain credentials or authentication secrets");
  }
  await audit({ action: "read_file", path: resolved, bytes: stat.size, outcome: "ok" });
  return { path: resolved, bytes: stat.size, content: redactSecrets(content) };
}

async function writeTextFile(filePath, content, { rejectSecrets = false } = {}) {
  if (rejectSecrets && publicPathLooksSensitive(filePath)) {
    throw new Error("public plugin refuses secret or credential file paths");
  }
  if (rejectSecrets && containsCredentialLikeSecret(content)) {
    throw new Error("public plugin refuses content that appears to contain credentials or authentication secrets");
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) throw new Error("content exceeds ZSSH_MAX_FILE_BYTES");
  const resolved = await resolveAllowedPath(filePath, { forWrite: true });
  const tmp = path.join(path.dirname(resolved), "." + path.basename(resolved) + ".zssh-" + crypto.randomUUID());
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.rename(tmp, resolved);
  await audit({ action: "write_file", path: resolved, bytes, outcome: "ok" });
  return { path: resolved, bytes };
}

function result(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError
  };
}

function authInfoFromExtra(extra) {
  return extra?.authInfo || extra?.http?.authInfo || null;
}

function publicSecurity(scope, extraMeta = {}) {
  if (PLUGIN_PROFILE !== "public") return {};
  const securitySchemes = [{ type: "oauth2", scopes: [scope] }];
  return {
    securitySchemes,
    _meta: {
      securitySchemes,
      ...extraMeta,
    }
  };
}

function publicProfileFromAuth(extra) {
  const authInfo = authInfoFromExtra(extra);
  return {
    id: profileIdFromAuth(authInfo, OAUTH_CONFIG?.resource || ""),
    name: "zSSH",
    nickname: TARGET_LABEL,
  };
}

function oauthToolError(extra, scope) {
  if (PLUGIN_PROFILE !== "public" || PUBLIC_AUTH_MODE !== "oauth") return null;
  try {
    requireScopes(authInfoFromExtra(extra), [scope]);
    return null;
  } catch (err) {
    const code = err?.code === "insufficient_scope" ? "insufficient_scope" : "invalid_token";
    const description = code === "insufficient_scope"
      ? "This zSSH action requires the " + scope + " permission."
      : "A valid zSSH OAuth access token is required.";
    return {
      content: [{ type: "text", text: description }],
      isError: true,
      _meta: {
        "mcp/www_authenticate": [
          bearerChallenge(OAUTH_CONFIG, {
            scope,
            error: code,
            errorDescription: description,
          })
        ]
      }
    };
  }
}

async function publicToolAuthorizationError(extra, scope, { requirePairing = true } = {}) {
  const oauthError = oauthToolError(extra, scope);
  if (oauthError) return oauthError;
  if (PLUGIN_PROFILE !== "public" || PUBLIC_AUTH_MODE !== "oauth" || !PAIRING_REQUIRED || !requirePairing) return null;

  const pairing = await getPairingStatus(authInfoFromExtra(extra), {
    resource: OAUTH_CONFIG?.resource || "",
    createRequest: false,
  });
  if (pairing.paired) return null;

  const message = pairing.pending
    ? "This OAuth profile is not paired to the Linux target yet. Approve pairing request " + pairing.request_id + " locally on the target."
    : "This OAuth profile is not paired to the Linux target. Call get_pairing_status to create a short-lived pairing request for local approval.";
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      paired: false,
      pending: Boolean(pairing.pending),
      profile_id: pairing.profile_id,
      request_id: pairing.request_id || null,
      expires_at: pairing.expires_at || null,
    },
    isError: true,
  };
}

function createMcpServer() {
  const server = new McpServer(
    { name: "zssh", version: VERSION },
    {
      instructions:
        PLUGIN_PROFILE === "public"
          ? "zSSH connects to one user-authorized Linux target. Use only the narrowly scoped tools exposed by this public profile. Prefer read-only inspection first, make file writes only when the user asked for them, and never request or echo credentials, private keys, tokens, or passwords."
          : "zSSH operates a private Linux target. Prefer read-only inspection first. Destructive commands are blocked in safe mode. Never request or echo credentials, private keys, tokens, or passwords."
    }
  );

  server.registerTool(
    "zssh_server_info",
    {
      title: "Server info",
      description: "Read basic identity and zSSH policy state for the connected Linux target.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      ...publicSecurity(OAUTH_CONFIG?.readScope || "zssh:read")
    },
    async (_args, extra) => {
      const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.readScope || "zssh:read");
      if (authError) return authError;
      if (PLUGIN_PROFILE === "public") {
        return result({
          version: VERSION,
          target_label: TARGET_LABEL,
          platform: process.platform,
          arch: process.arch,
          exec_mode: EXEC_MODE,
          plugin_profile: PLUGIN_PROFILE,
          auth_mode: PUBLIC_AUTH_MODE,
          pairing_required: PAIRING_REQUIRED
        });
      }
      return result({
        version: VERSION,
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        uid: typeof process.getuid === "function" ? process.getuid() : null,
        exec_mode: EXEC_MODE,
        plugin_profile: PLUGIN_PROFILE,
        safe_programs: getEnabledSafePrograms(),
        allowed_roots: getAllowedRoots(),
        timeout_seconds: COMMAND_TIMEOUT_SECONDS,
        max_output_bytes: MAX_OUTPUT_BYTES,
        auth_mode: "private",
        pairing_required: false
      });
    }
  );

  server.registerTool(
    "zssh_read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file inside configured zSSH allowed roots. Secret-like values are redacted.",
      inputSchema: { path: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      ...publicSecurity(OAUTH_CONFIG?.readScope || "zssh:read")
    },
    async ({ path: filePath }, extra) => {
      const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.readScope || "zssh:read");
      if (authError) return authError;
      try {
        return result(await readTextFile(filePath, { rejectSecrets: PLUGIN_PROFILE === "public" }));
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );

  server.registerTool(
    "zssh_write_file",
    {
      title: "Write file",
      description: "Atomically replace or create a UTF-8 text file inside configured zSSH allowed roots.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      ...publicSecurity(OAUTH_CONFIG?.writeScope || "zssh:write")
    },
    async ({ path: filePath, content }, extra) => {
      const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.writeScope || "zssh:write");
      if (authError) return authError;
      try {
        return result({ ok: true, ...(await writeTextFile(filePath, content, { rejectSecrets: PLUGIN_PROFILE === "public" })) });
      } catch (err) {
        return result({ ok: false, error: String(err?.message || err) }, true);
      }
    }
  );


  if (PLUGIN_PROFILE === "public") {
    server.registerResource("zssh-connection-status", CONNECTION_UI_URI, {}, async () => ({
      contents: [
        {
          uri: CONNECTION_UI_URI,
          mimeType: "text/html;profile=mcp-app",
          text: CONNECTION_UI_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription": "Compact zSSH connection and target-pairing status. Pairing approval remains local to the Linux target.",
          },
        },
      ],
    }));

    server.registerTool(
      "get_profile",
      {
        title: "Get connected zSSH profile",
        description: "Return the stable profile represented by the current authenticated zSSH connection.",
        inputSchema: {},
        outputSchema: {
          id: z.string().min(1),
          name: z.string().optional(),
          nickname: z.string().optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        ...publicSecurity(OAUTH_CONFIG?.readScope || "zssh:read", { "openai/profile": true })
      },
      async (_args, extra) => {
        const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.readScope || "zssh:read", { requirePairing: false });
        if (authError) return authError;
        try {
          const profile = publicProfileFromAuth(extra);
          return {
            content: [{ type: "text", text: JSON.stringify(profile) }],
            structuredContent: profile,
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: "Authentication required for profile resolution." }],
            isError: true,
            _meta: {
              "mcp/www_authenticate": [
                bearerChallenge(OAUTH_CONFIG, {
                  scope: OAUTH_CONFIG?.readScope || "zssh:read",
                  error: "invalid_token",
                  errorDescription: String(err?.message || "Authentication required"),
                })
              ]
            }
          };
        }
      }
    );

    server.registerTool(
      "get_pairing_status",
      {
        title: "Get target pairing status",
        description: "Check whether the current authenticated profile is approved to use this Linux target. If approval is needed, create or return a short-lived local pairing request.",
        inputSchema: {},
        outputSchema: {
          paired: z.boolean(),
          pending: z.boolean(),
          profile_id: z.string().min(1),
          target_label: z.string().min(1),
          request_id: z.string().nullable().optional(),
          expires_at: z.string().nullable().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        ...publicSecurity(OAUTH_CONFIG?.readScope || "zssh:read", {
          ui: { resourceUri: CONNECTION_UI_URI },
          "openai/outputTemplate": CONNECTION_UI_URI,
          "openai/toolInvocation/invoking": "Checking zSSH connection…",
          "openai/toolInvocation/invoked": "zSSH connection checked.",
        })
      },
      async (_args, extra) => {
        const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.readScope || "zssh:read", { requirePairing: false });
        if (authError) return authError;
        try {
          const pairing = await getPairingStatus(authInfoFromExtra(extra), {
            resource: OAUTH_CONFIG?.resource || "",
            createRequest: true,
          });
          const value = {
            paired: Boolean(pairing.paired),
            pending: Boolean(pairing.pending),
            profile_id: pairing.profile_id,
            target_label: TARGET_LABEL,
            request_id: pairing.request_id || null,
            expires_at: pairing.expires_at || null,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(value) }],
            structuredContent: value,
            isError: false,
          };
        } catch (err) {
          return result({ ok: false, error: String(err?.message || err) }, true);
        }
      }
    );

    const registerReadOnlyProgramTool = (name, title, description, program, args = []) => {
      server.registerTool(
        name,
        {
          title,
          description,
          inputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          ...publicSecurity(OAUTH_CONFIG?.readScope || "zssh:read")
        },
        async (_args, extra) => {
          const authError = await publicToolAuthorizationError(extra, OAUTH_CONFIG?.readScope || "zssh:read");
          if (authError) return authError;
          try {
            const value = await runSafeProgram(program, args);
            return result(value, !value.ok);
          } catch (err) {
            return result({ ok: false, error: String(err?.message || err) }, true);
          }
        }
      );
    };

    registerReadOnlyProgramTool(
      "get_system_uptime",
      "Get system uptime",
      "Read the connected Linux target's current uptime and load averages. This does not modify the target.",
      "uptime"
    );
    registerReadOnlyProgramTool(
      "get_system_identity",
      "Get system identity",
      "Read the effective Linux user and group identity used by zSSH on the connected target. This does not modify the target.",
      "id"
    );
    registerReadOnlyProgramTool(
      "get_kernel_info",
      "Get kernel info",
      "Read the connected Linux target's kernel, hostname, architecture, and operating-system information. This does not modify the target.",
      "uname",
      ["-a"]
    );
    registerReadOnlyProgramTool(
      "get_disk_usage",
      "Get disk usage",
      "Read filesystem capacity and free-space information for mounted filesystems on the connected Linux target. This does not modify the target.",
      "df",
      ["-h"]
    );
    registerReadOnlyProgramTool(
      "get_memory_usage",
      "Get memory usage",
      "Read current memory and swap usage on the connected Linux target. This does not modify the target.",
      "free",
      ["-h"]
    );
  } else {
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
        description: "Run one bounded shell command on the connected Linux target. Raw shell is disabled by default and must be explicitly enabled for a trusted/disposable target.",
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

function capabilityAuthorized(pathname) {
  return Boolean(CAPABILITY_TOKEN) && secureEqual(pathname, "/mcp/" + CAPABILITY_TOKEN);
}

async function authorizeRequest(req) {
  if (PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "oauth") {
    const authInfo = await verifyOAuthAuthorizationHeader(req.headers.authorization, OAUTH_CONFIG);
    // MCP SDK v1 reads req.auth and forwards it to tool callbacks as extra.authInfo.
    req.auth = authInfo;
    return authInfo;
  }

  if (TRUST_LOCAL_TUNNEL && isLoopbackRequest(req)) return { mode: "trusted-loopback" };

  // Private/trusted clients keep the existing static auth methods.
  if (secureEqual(req.headers["x-zssh-key"], API_KEY)) return { mode: "api-key" };
  if (secureEqual(req.headers.authorization, DEV_TOKEN ? "Bearer " + DEV_TOKEN : "")) return { mode: "bearer" };

  if (!API_KEY && !DEV_TOKEN && process.env.NODE_ENV !== "production") return { mode: "development" };
  const error = new Error("unauthorized");
  error.code = "invalid_token";
  throw error;
}

function unauthorizedResponse(res, error) {
  const headers = { "content-type": "application/json" };
  if (PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "oauth" && OAUTH_CONFIG) {
    headers["WWW-Authenticate"] = bearerChallenge(OAUTH_CONFIG, {
      error: error?.code === "insufficient_scope" ? "insufficient_scope" : "invalid_token",
      errorDescription: "A valid zSSH OAuth access token is required.",
    });
  }
  return res.writeHead(401, headers).end(JSON.stringify({ error: "unauthorized" }));
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
  if (PLUGIN_PROFILE === "public" && EXEC_MODE === "full") {
    throw new Error("public plugin profile refuses ZSSH_EXEC_MODE=full; raw shell must stay disabled");
  }
  if (PLUGIN_PROFILE === "public" && process.env.NODE_ENV === "production" && !String(process.env.ZSSH_PUBLIC_ALLOWED_ROOTS || "").trim()) {
    throw new Error("production public profile requires explicit ZSSH_PUBLIC_ALLOWED_ROOTS; do not reuse broad private filesystem roots");
  }
  if (PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "oauth" && !OAUTH_CONFIG) {
    throw new Error("public plugin OAuth requires ZSSH_OAUTH_ISSUER, ZSSH_PUBLIC_BASE_URL, and ZSSH_OAUTH_JWKS_URI");
  }
  if (PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "oauth" && process.env.NODE_ENV === "production") {
    for (const [name, value] of [["ZSSH_OAUTH_ISSUER", OAUTH_CONFIG.issuer], ["ZSSH_PUBLIC_BASE_URL", OAUTH_CONFIG.resource], ["ZSSH_OAUTH_JWKS_URI", OAUTH_CONFIG.jwksUri]]) {
      if (new URL(value).protocol !== "https:") throw new Error(name + " must use HTTPS in production");
    }
  }
  if (PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "legacy" && process.env.NODE_ENV === "production" && process.env.ZSSH_ALLOW_LEGACY_PUBLIC_AUTH !== "1") {
    throw new Error("production public profile requires OAuth; legacy auth is allowed only with explicit ZSSH_ALLOW_LEGACY_PUBLIC_AUTH=1");
  }
  if (PLUGIN_PROFILE === "public" && !PAIRING_REQUIRED && process.env.NODE_ENV === "production" && process.env.ZSSH_ALLOW_UNPAIRED_PUBLIC !== "1") {
    throw new Error("production public profile requires target pairing; disabling it requires explicit ZSSH_ALLOW_UNPAIRED_PUBLIC=1");
  }
  if (process.env.NODE_ENV === "production" && !(PLUGIN_PROFILE === "public" && PUBLIC_AUTH_MODE === "oauth") && !CAPABILITY_TOKEN && !API_KEY && !DEV_TOKEN && !TRUST_LOCAL_TUNNEL) {
    throw new Error("production requires authentication; configure a capability token, ZSSH_API_KEY, a bearer token, or explicitly trust the loopback tunnel");
  }

  const httpServer = createServer(async (req, res) => {
    if (!req.url) return res.writeHead(400).end("Missing URL");
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
      if (!OPENAI_APPS_CHALLENGE_TOKEN) return res.writeHead(404).end("Not Found");
      return res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(OPENAI_APPS_CHALLENGE_TOKEN);
    }

    if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      if (PLUGIN_PROFILE !== "public" || PUBLIC_AUTH_MODE !== "oauth" || !OAUTH_CONFIG) return res.writeHead(404).end("Not Found");
      return res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=300" }).end(JSON.stringify(protectedResourceMetadata(OAUTH_CONFIG)));
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, service: "zssh", version: VERSION }));
    }

    const capabilityAuth = capabilityAuthorized(url.pathname);
    if (url.pathname !== "/mcp" && !capabilityAuth) return res.writeHead(404).end("Not Found");
    cors(res);

    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (!capabilityAuth) {
      try {
        await authorizeRequest(req);
      } catch (err) {
        return unauthorizedResponse(res, err);
      }
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
    console.log("zSSH listening on http://127.0.0.1:" + PORT + "/mcp");
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
