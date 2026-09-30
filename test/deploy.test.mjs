import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

test("live installer keeps production raw shell fail-closed and secrets outside repo", async () => {
  const text = await readFile(path.join(ROOT, "deploy", "install-live.sh"), "utf8");
  assert.match(text, /NODE_ENV=production/);
  assert.match(text, /ZSSH_EXEC_MODE=disabled/);
  assert.match(text, /ZSSH_API_KEY/);
  assert.match(text, /ZSSH_MCP_CAPABILITY_TOKEN/);
  assert.match(text, /ZSSH_CLIENT_TOKENS_FILE/);
  assert.match(text, /ZSSH_PROFILE=\$PROFILE/);
  assert.match(text, /ZSSH_PROFILE=private/);
  assert.match(text, /bin\/zssh\.mjs/);
  assert.match(text, /INITIAL_CONNECTION_OUTPUT/);
  assert.match(text, /openssl rand -hex 32|randomBytes\(32\)/);
  assert.match(text, /gateway\.env/);
  assert.match(text, /chmod 600 "\$ENV_FILE"/);
  assert.match(text, /live-canary\.mjs/);
  assert.doesNotMatch(text, /ZSSH_DEV_BEARER_TOKEN=[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(text, /\bsudo\b/);
});

test("user service applies restart and baseline sandbox controls", async () => {
  const text = await readFile(path.join(ROOT, "deploy", "zssh.service.in"), "utf8");
  assert.match(text, /Restart=always/);
  assert.match(text, /NoNewPrivileges=false/);
  assert.match(text, /PrivateTmp=true/);
  assert.match(text, /RestrictSUIDSGID=true/);
  assert.match(text, /EnvironmentFile=%h\/\.config\/zssh\/gateway\.env/);
});

test("live MCP canary proves fail-closed raw shell plus safe execution", async () => {
  const text = await readFile(path.join(ROOT, "live-canary.mjs"), "utf8");
  assert.match(text, /zssh_server_info/);
  assert.match(text, /zssh_run_safe/);
  assert.match(text, /exec_mode !== "disabled"/);
  assert.match(text, /program: "whoami"/);
  assert.doesNotMatch(text, /console\.log\([^\n]*token/i);
});


test("onboarding scripts preserve secure defaults and loopback-only tunnel setup", async () => {
  const bootstrap = await readFile(path.join(ROOT, "deploy", "bootstrap-vps.sh"), "utf8");
  const tunnel = await readFile(path.join(ROOT, "deploy", "configure-tunnel.sh"), "utf8");
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(bootstrap, /Refusing to bootstrap zSSH as root/);
  assert.match(bootstrap, /ZSSH_EXPECTED_SHA/);
  assert.match(tunnel, /CONTROL_PLANE_API_KEY/);
  assert.match(tunnel, /chmod 600/);
  assert.match(tunnel, /127\.0\.0\.1:8788\/mcp/);
  assert.match(tunnel, /ZSSH_TRUST_LOCAL_TUNNEL=1/);
  assert.match(server, /isLoopbackRequest/);
  assert.match(server, /TRUST_LOCAL_TUNNEL/);
  assert.match(server, /httpServer\.listen\(PORT, "127\.0\.0\.1"/);
});

test("generic Linux onboarding avoids account-specific assumptions and preserves legacy installs", async () => {
  const bootstrap = await readFile(path.join(ROOT, "deploy", "bootstrap-linux.sh"), "utf8");
  const diagnose = await readFile(path.join(ROOT, "ops", "diagnose.sh"), "utf8");
  const installer = await readFile(path.join(ROOT, "deploy", "install-live.sh"), "utf8");
  const env = await readFile(path.join(ROOT, ".env.example"), "utf8");
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");

  assert.doesNotMatch(bootstrap, /\/home\/ubuntu|zennay-cloud/);
  assert.doesNotMatch(diagnose, /\/home\/ubuntu|zennay-cloud/);
  assert.match(installer, /\$HOME\/zennay-cloud/);
  assert.match(installer, /\$HOME\/zssh-workspace/);
  assert.match(installer, /ZSSH_TARGET_NAME/);
  assert.match(env, /ZSSH_TARGET_NAME=my-linux-target/);
  assert.doesNotMatch(env, /\/home\/ubuntu/);
  assert.match(server, /target_name: TARGET_NAME/);
});

test("Claude configuration uses remote HTTP with explicit auth", async () => {
  const config = await readFile(path.join(ROOT, "deploy", "claude-code.example.json"), "utf8");
  assert.match(config, /"type": "http"/);
  assert.match(config, /\/mcp/);
  assert.match(config, /Authorization/);
  assert.match(config, /Bearer YOUR_ZSSH_BEARER_TOKEN/);
});

test("Claude canary supports capability URL, static header, and bearer auth", async () => {
  const text = await readFile(path.join(ROOT, "mcp-claude-canary.mjs"), "utf8");
  assert.match(text, /StreamableHTTPClientTransport/);
  assert.match(text, /ZSSH_MCP_CAPABILITY_TOKEN/);
  assert.match(text, /capability-url/);
  assert.match(text, /\/mcp\/\[REDACTED\]/);
  assert.match(text, /x-zssh-key/);
  assert.match(text, /Authorization/);
  assert.match(text, /zssh_server_info/);
  assert.match(text, /compatible: "claude-mcp"/);
});

test("self-hosted auth accepts legacy credentials plus revocable client capability tokens", async () => {
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  const authStore = await readFile(path.join(ROOT, "auth-store.mjs"), "utf8");
  const cli = await readFile(path.join(ROOT, "bin", "zssh.mjs"), "utf8");
  assert.match(server, /ZSSH_MCP_CAPABILITY_TOKEN/);
  assert.match(server, /staticCapabilityAuthorized/);
  assert.match(server, /verifyClientToken/);
  assert.match(server, /ZSSH_API_KEY/);
  assert.match(server, /x-zssh-key/);
  assert.match(server, /authorization/);
  assert.match(authStore, /sha256/);
  assert.match(authStore, /revokeClientToken/);
  assert.match(cli, /zssh connect/);
  assert.doesNotMatch(server, /oauth\/approve|claude-auth\.mjs|mcpAuthRouter/);
});

test("plugin profile hides generic power tools and exposes bounded operations", async () => {
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  const canary = await readFile(path.join(ROOT, "plugin-canary.mjs"), "utf8");
  assert.match(server, /ZSSH_PROFILE/);
  assert.match(server, /pluginMode/);
  assert.match(server, /zssh_get_profile/);
  assert.match(server, /"openai\/profile": true/);
  assert.match(server, /zssh_git_status/);
  assert.match(server, /zssh_git_pull/);
  assert.match(server, /zssh_service_status/);
  assert.match(server, /zssh_restart_service/);
  assert.match(server, /if \(!pluginMode\)/);
  assert.match(canary, /private-only MCP tool leaked into plugin profile/);
  assert.match(canary, /zssh_exec/);
  assert.match(canary, /zssh_write_file/);
});
