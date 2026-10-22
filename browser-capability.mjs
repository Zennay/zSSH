// Private zSSH MCP capability loader: run Playwright INSIDE the existing zSSH process.
// BrowserAgent is an optional local npm checkout, never an extra HTTP port or long-lived daemon.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";

let loaded;
export async function runBrowserCapability(request, { env = process.env } = {}) {
  if (env.ZSSH_BROWSER_ENABLED !== "1") return { ok: false, code: "disabled", error: "zSSH browser capability is disabled" };
  const file = String(env.ZSSH_BROWSER_CAPABILITY_FILE || "").trim();
  if (!path.isAbsolute(file) || !file.endsWith("/src/zssh-capability.mjs")) {
    return { ok: false, code: "configuration", error: "Set absolute ZSSH_BROWSER_CAPABILITY_FILE to BrowserAgent/src/zssh-capability.mjs" };
  }
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, code: "configuration", error: "Browser capability source must be a regular file" };
  if (!loaded) loaded = import(pathToFileURL(file).href);
  const api = await loaded;
  if (typeof api.runZsshBrowserCommand !== "function") throw Error("Browser module export missing");
  return await api.runZsshBrowserCommand(request);
}
