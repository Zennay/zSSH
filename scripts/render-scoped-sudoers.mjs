#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/;
const ABS_COMMAND_RE = /^\/[A-Za-z0-9_./+-]+$/;

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function validateServiceUser(value) {
  const user = String(value || "").trim();
  if (!USER_RE.test(user)) {
    throw new Error("service user must match ^[a-z_][a-z0-9_-]{0,31}$");
  }
  return user;
}

export function validateServiceUnit(value) {
  const unit = String(value || "").trim();
  if (!SERVICE_RE.test(unit)) {
    throw new Error("service unit must be an exact .service name without whitespace, slashes, or wildcards");
  }
  return unit;
}

export function validateSystemctlPath(value) {
  const command = String(value || "").trim();
  if (!path.isAbsolute(command) || !ABS_COMMAND_RE.test(command) || path.basename(command) !== "systemctl") {
    throw new Error("systemctl path must be an absolute path ending in systemctl with no shell metacharacters");
  }
  return command;
}

export function renderScopedSudoers({
  user,
  inspectServices = [],
  restartServices = [],
  systemctlPath = "/usr/bin/systemctl",
} = {}) {
  const serviceUser = validateServiceUser(user);
  const systemctl = validateSystemctlPath(systemctlPath);
  const inspect = uniqueSorted([
    ...inspectServices.map(validateServiceUnit),
    ...restartServices.map(validateServiceUnit),
  ]);
  const restart = uniqueSorted(restartServices.map(validateServiceUnit));

  if (!inspect.length && !restart.length) {
    throw new Error("at least one inspect or restart service capability is required");
  }

  const lines = [
    "# Managed by zSSH deploy/install-scoped-sudo.sh",
    "# Exact command arguments only; do not replace these with wildcard or argument-less grants.",
  ];

  if (inspect.length) {
    const commands = inspect.flatMap(unit => [
      `${systemctl} status ${unit} --no-pager`,
      `${systemctl} is-active ${unit}`,
    ]);
    lines.push(`Cmnd_Alias ZSSH_SYSTEMD_INSPECT = ${commands.join(", ")}`);
  }

  if (restart.length) {
    const commands = restart.map(unit => `${systemctl} restart ${unit}`);
    lines.push(`Cmnd_Alias ZSSH_SYSTEMD_RESTART = ${commands.join(", ")}`);
  }

  const aliases = [];
  if (inspect.length) aliases.push("ZSSH_SYSTEMD_INSPECT");
  if (restart.length) aliases.push("ZSSH_SYSTEMD_RESTART");
  lines.push(`${serviceUser} ALL=(root) NOPASSWD: NOSETENV: ${aliases.join(", ")}`);

  return lines.join("\n") + "\n";
}

function parseArgs(argv) {
  const config = { inspectServices: [], restartServices: [], systemctlPath: "/usr/bin/systemctl" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === "--user") config.user = next();
    else if (arg === "--inspect-service") config.inspectServices.push(next());
    else if (arg === "--restart-service") config.restartServices.push(next());
    else if (arg === "--systemctl-path") config.systemctlPath = next();
    else if (arg === "--help") config.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return config;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/render-scoped-sudoers.mjs --user <linux-user> [capabilities]",
    "",
    "Capabilities:",
    "  --inspect-service <name.service>   allow exact status/is-active commands",
    "  --restart-service <name.service>   allow exact restart plus inspection",
    "  --systemctl-path </absolute/systemctl>  default: /usr/bin/systemctl",
  ].join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) {
      process.stdout.write(usage() + "\n");
      process.exit(0);
    }
    process.stdout.write(renderScopedSudoers(config));
  } catch (error) {
    process.stderr.write(`zSSH scoped-sudo policy error: ${error.message}\n`);
    process.exit(2);
  }
}
