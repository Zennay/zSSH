import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("real gateway requires OAuth even in development and executes MCP tools after owner consent", async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "zssh-claude-gateway-"));
  const root = await realpath(temporary);
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = crypto.randomBytes(32).toString("hex");
  const publicOrigin = "https://zssh.test.example";
  Object.assign(process.env, {
    NODE_ENV: "development", PORT: "0", ZSSH_DEV_BEARER_TOKEN: "",
    ZSSH_PUBLIC_URL: publicOrigin, ZSSH_OWNER_PASSWORD: owner,
    ZSSH_TRUST_LOCAL_TUNNEL: "0", ZSSH_EXEC_MODE: "disabled",
    ZSSH_ALLOWED_ROOTS: root, ZSSH_AUDIT_LOG: path.join(root, "audit.jsonl")
  });
  const { start } = await import("../server.mjs");
  const server = start();
  await once(server, "listening");
  let client;
  t.after(async () => {
    await client?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(base + route, options);
  const unauthorized = await request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get("www-authenticate").includes("resource_metadata"));
  const registration = await request("/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude test", redirect_uris: ["https://claude.ai/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] })
  });
  const clientInfo = await registration.json();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({ client_id: clientInfo.client_id, response_type: "code", redirect_uri: "https://claude.ai/callback", code_challenge: challenge, code_challenge_method: "S256", resource: publicOrigin + "/mcp" });
  const html = await (await request("/authorize?" + params)).text();
  const consentId = html.match(/name="request" value="([^"]+)"/)[1];
  const consent = await request("/oauth/approve", {
    method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", Origin: publicOrigin },
    body: new URLSearchParams({ request: consentId, password: owner })
  });
  assert.equal(consent.status, 302);
  const code = new URL(consent.headers.get("location")).searchParams.get("code");
  const tokenResponse = await request("/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientInfo.client_id, redirect_uri: "https://claude.ai/callback", code, code_verifier: verifier, resource: publicOrigin + "/mcp" })
  });
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  client = new Client({ name: "claude-integration-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token.access_token } } }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 5);
  const result = await client.callTool({ name: "zssh_server_info", arguments: {} });
  const info = JSON.parse(result.content.find(part => part.type === "text").text);
  assert.notEqual(info.uid, 0);
  assert.equal(info.exec_mode, "disabled");
  const command = await client.callTool({ name: "zssh_run_safe", arguments: { program: "whoami" } });
  assert.equal(JSON.parse(command.content[0].text).ok, true);
  const denied = await client.callTool({ name: "zssh_exec", arguments: { command: "echo should-not-run" } });
  assert.equal(denied.isError, true);
});
