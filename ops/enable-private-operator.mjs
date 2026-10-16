#!/usr/bin/env node
// Explicitly opt in to maximum *private* access as the unprivileged zSSH service user.
// This never grants root/sudo, changes the public target-agent policy, or publishes a port.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const acknowledge = args.includes("--accept-risk");
const allowedArgs = new Set(["--check", "--apply", "--accept-risk"]);
const envFile = process.env.ZSSH_ENV_FILE || path.join(os.homedir(), ".config", "zssh", "gateway.env");
const maximal = new Map([
  ["ZSSH_PLUGIN_PROFILE", "private"],
  ["ZSSH_ALLOWED_ROOTS", "/"],
  ["ZSSH_EXEC_MODE", "full"],
  ["ZSSH_COMMAND_TIMEOUT_SECONDS", "300"],
  ["ZSSH_MAX_OUTPUT_BYTES", "1048576"],
  ["ZSSH_MAX_FILE_BYTES", "1048576"],
]);

function fail(message) {
  process.stderr.write("zSSH private operator: " + message + "\n");
  process.exit(2);
}

if (args.some(arg => !allowedArgs.has(arg)) || (args.includes("--check") && apply)) {
  fail("Usage: node ops/enable-private-operator.mjs --check | --apply --accept-risk");
}
if (apply && !acknowledge) fail("Refusing maximum access without --accept-risk");
if (typeof process.getuid !== "function" || process.getuid() === 0) {
  fail("Run only as the unprivileged zSSH service owner, never as root");
}

let stat;
try { stat = fs.lstatSync(envFile); }
catch { fail("Private gateway configuration does not exist: " + envFile); }
if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
  fail("Configuration must be a regular, non-symlink file owned by the current user");
}
if ((stat.mode & 0o077) !== 0) {
  fail("Configuration must not be accessible to group or others (chmod 600)");
}

const original = fs.readFileSync(envFile, "utf8");
const lines = original.split(/\r?\n/);
const values = new Map();
const seen = new Set();
for (const line of lines) {
  const found = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!found) continue;
  const [, key, value] = found;
  if (seen.has(key)) fail("Duplicate configuration key: " + key);
  seen.add(key);
  values.set(key, value);
}
if (values.get("ZSSH_PLUGIN_PROFILE") === "public") {
  fail("The public OAuth/plugin profile cannot be converted to private operator mode");
}
if (values.has("ZSSH_AGENT_PRIVATE_KEY_FILE") || values.has("ZSSH_GATEWAY_URL")) {
  fail("Refusing target-agent configuration; this tool is for gateway.env only");
}
const authenticated = [
  "ZSSH_DEV_BEARER_TOKEN", "ZSSH_API_KEY", "ZSSH_MCP_CAPABILITY_TOKEN"
].some(key => {
  const value = (values.get(key) || "").trim();
  return value.length >= 32 && !/^(replace|changeme|example)/i.test(value);
}) || values.get("ZSSH_TRUST_LOCAL_TUNNEL") === "1" ||
  Boolean((values.get("ZSSH_CLIENT_TOKENS_FILE") || "").trim());
if (!authenticated) fail("Refusing a private gateway without a configured authentication method");

if (!apply) {
  process.stdout.write(
    "ZSSH_PRIVATE_OPERATOR_CHECK_OK\n" +
    "Would enable private-only full shell and maximum file/timeout/output limits.\n" +
    "Allowed roots: / (limited by the zSSH Linux service user's actual permissions).\n" +
    "No changes made. Run --apply --accept-risk to change configuration.\n"
  );
  process.exit(0);
}

const remaining = new Set(maximal.keys());
const updated = lines.map(line => {
  const found = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!found || !maximal.has(found[1])) return line;
  const key = found[1];
  remaining.delete(key);
  return key + "=" + maximal.get(key);
});
for (const key of remaining) updated.push(key + "=" + maximal.get(key));
const next = updated.join("\n").replace(/\n*$/, "\n");
const tmp = path.join(path.dirname(envFile), ".gateway.env.operator-" + crypto.randomUUID());
try {
  fs.writeFileSync(tmp, next, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, envFile);
} finally {
  try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== "ENOENT") throw err; }
}
process.stdout.write(
  "ZSSH_PRIVATE_OPERATOR_APPLIED\n" +
  "Private profile: full shell; allowed roots: /; file/output limit: 1 MiB; command timeout: 300 s.\n" +
  "Only files and operations accessible to the Linux service user are writable.\n" +
  "Restart with: systemctl --user restart zssh.service\n"
);
