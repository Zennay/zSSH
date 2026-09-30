import { readFile, writeFile, rename, chmod, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { validatePublicUrl } from "../claude-auth.mjs";

if (process.getuid?.() === 0) throw new Error("Run as the dedicated zSSH VPS user, not root");
const origin = validatePublicUrl(process.argv[2]).origin;
const configDir = path.join(os.homedir(), ".config/zssh");
const configFile = path.join(configDir, "gateway.env");
let config = await readFile(configFile, "utf8");
const owner = config.match(/^ZSSH_OWNER_PASSWORD=([^\r\n]+)$/m)?.[1];
if (owner && !/^[a-zA-Z0-9_-]{32,512}$/.test(owner)) throw new Error("Existing owner code must be a 32–512 character unquoted random value");
const code = owner || crypto.randomBytes(32).toString("hex");
for (const key of ["ZSSH_PUBLIC_URL", "ZSSH_OWNER_PASSWORD", "ZSSH_TRUST_LOCAL_TUNNEL"]) {
  config = config.replace(new RegExp(`^${key}=.*(?:\r?\n|$)`, "gm"), "");
}
config = config.trimEnd() + `\nZSSH_PUBLIC_URL=${origin}\nZSSH_OWNER_PASSWORD=${code}\nZSSH_TRUST_LOCAL_TUNNEL=0\n`;
await mkdir(configDir, { recursive: true, mode: 0o700 });
await chmod(configFile, 0o600);
const backup = `${configFile}.before-claude`;
await writeFile(backup, await readFile(configFile), { mode: 0o600 });
await chmod(backup, 0o600);
const temporary = `${configFile}.${process.pid}.tmp`;
await writeFile(temporary, config, { mode: 0o600, flag: "wx" });
await rename(temporary, configFile);
const restarted = spawnSync("systemctl", ["--user", "restart", "zssh.service"], { stdio: "inherit" });
if (restarted.status !== 0) {
  await writeFile(configFile, await readFile(backup), { mode: 0o600 });
  spawnSync("systemctl", ["--user", "restart", "zssh.service"], { stdio: "inherit" });
  throw new Error("Service restart failed; previous gateway settings restored");
}
console.log(`Claude connector URL: ${origin}/mcp`);
console.log(`Owner connection code stored in ${configFile} (ZSSH_OWNER_PASSWORD). View it privately in your SSH terminal; do not paste it into a chat.`);
