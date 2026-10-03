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



test("generic Linux bootstrap is provider-agnostic and diagnostics stay secret-safe", async () => {
  const bootstrap = await readFile(path.join(ROOT, "deploy", "bootstrap-linux.sh"), "utf8");
  const diagnose = await readFile(path.join(ROOT, "ops", "diagnose.sh"), "utf8");

  assert.match(bootstrap, /Refusing to bootstrap zSSH as root/);
  assert.match(bootstrap, /Node\.js >=20 required/);
  assert.match(bootstrap, /ZSSH_EXPECTED_SHA/);
  assert.match(bootstrap, /zssh-workspace/);
  assert.match(bootstrap, /deploy\/install-live\.sh/);
  assert.doesNotMatch(bootstrap, /\/home\/ubuntu|zennay-cloud/);

  assert.match(diagnose, /systemctl --user status zssh\.service/);
  assert.match(diagnose, /127\.0\.0\.1:\$PORT\/health/);
  assert.match(diagnose, /ZSSH_PLUGIN_PROFILE/);
  assert.match(diagnose, /ZSSH_PUBLIC_AUTH_MODE/);
  assert.match(diagnose, /ZSSH_ALLOWED_ROOTS/);
  assert.doesNotMatch(diagnose, /ZSSH_DEV_BEARER_TOKEN|ZSSH_API_KEY|ZSSH_MCP_CAPABILITY_TOKEN|OPENAI_APPS_CHALLENGE_TOKEN/);
  assert.doesNotMatch(diagnose, /cat .*gateway\.env/);
  assert.doesNotMatch(diagnose, /\/home\/ubuntu|zennay-cloud/);
});



test("private client-token auth is revocable and cannot bypass public OAuth", async () => {
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  const installer = await readFile(path.join(ROOT, "deploy", "install-live.sh"), "utf8");
  const cli = await readFile(path.join(ROOT, "bin", "zssh.mjs"), "utf8");
  const authStore = await readFile(path.join(ROOT, "auth-store.mjs"), "utf8");

  assert.match(server, /verifyClientToken/);
  assert.match(server, /CLIENT_TOKEN_AUTH_CONFIGURED/);
  assert.match(server, /PLUGIN_PROFILE === "public".*CLIENT_TOKEN_AUTH_CONFIGURED/s);
  assert.match(server, /Public OAuth is deliberately exclusive/);
  assert.match(server, /REDACTED_ZSSH_TOKEN/);
  assert.match(installer, /ZSSH_CLIENT_TOKENS_FILE=\$CONFIG\/clients\.json/);
  assert.match(installer, /\.local\/bin/);
  assert.match(installer, /bin\/zssh\.mjs/);
  assert.match(cli, /zssh token revoke/);
  assert.match(cli, /ZSSH_PUBLIC_URL must use https:\/\//);
  assert.match(authStore, /sha256/);
  assert.match(authStore, /timingSafeEqual/);
  assert.match(authStore, /mode: 0o600/);
  assert.doesNotMatch(authStore, /token[^\n]*JSON\.stringify/);
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

test("hosted MCP auth avoids browser OAuth and accepts no-sign-in capability URLs", async () => {
  const server = await readFile(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(server, /ZSSH_MCP_CAPABILITY_TOKEN/);
  assert.match(server, /capabilityAuthorized/);
  assert.match(server, /ZSSH_API_KEY/);
  assert.match(server, /x-zssh-key/);
  assert.match(server, /authorization/);
  assert.doesNotMatch(server, /oauth\/approve|claude-auth\.mjs|mcpAuthRouter/);
});


test("target agent installer is non-root, immutable, and never shell-evaluates agent.env", async () => {
  const installer = await readFile(path.join(ROOT, "deploy", "install-target-agent.sh"), "utf8");
  const unit = await readFile(path.join(ROOT, "deploy", "zssh-agent.service.in"), "utf8");
  const agent = await readFile(path.join(ROOT, "target-agent.mjs"), "utf8");

  assert.match(installer, /Refusing to install zSSH target agent as root/);
  assert.match(installer, /ZSSH_EXPECTED_SHA/);
  assert.match(installer, /BASE="\$HOME\/\.local\/share\/zssh-agent"/);
  assert.match(installer, /RELEASES="\$BASE\/releases"/);
  assert.match(installer, /chmod 600 "\$ENV_FILE"/);
  assert.match(installer, /read_env_value/);
  assert.doesNotMatch(installer, /source "\$ENV_FILE"/);
  assert.match(installer, /https:\/\//);
  assert.match(installer, /agent private key must not be group\/world accessible/);

  assert.match(unit, /EnvironmentFile=%h\/\.config\/zssh\/agent\.env/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /PrivateTmp=true/);

  assert.match(agent, /refuses to run as root/);
  assert.match(agent, /ZSSH_PUBLIC_ALLOWED_ROOTS/);
  assert.match(agent, /ZSSH_EXEC_MODE = "disabled"/);
  assert.doesNotMatch(agent, /zssh_exec/);
  assert.doesNotMatch(agent, /createServer|listen\(/);
});
