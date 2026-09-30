import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { OwnerOAuthProvider, createClaudeAuth, validatePublicUrl } from "../claude-auth.mjs";

const origin = "https://zssh.test.example";
const ownerPassword = crypto.randomBytes(32).toString("hex");
const callback = "https://claude.ai/api/mcp/auth_callback";
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

async function fixture(t) {
  const auth = createClaudeAuth({ ZSSH_PUBLIC_URL: origin, ZSSH_OWNER_PASSWORD: ownerPassword });
  const app = express();
  app.use(auth.router);
  app.get("/mcp", auth.authenticate, (req, res) => res.json({ ok: true, client: req.auth.clientId }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(base + route, options);
  const register = async (overrides = {}) => {
    const response = await request("/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...overrides })
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const client = await register();
  const begin = async (overrides = {}) => {
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "zssh:operate", state: "expected-state", resource: origin + "/mcp", ...overrides });
    const response = await request("/authorize?" + query);
    const html = await response.text();
    assert.equal(response.status, 200, html);
    return { id: html.match(/name="request" value="([^"]+)"/)[1], html };
  };
  const approve = (id, password = ownerPassword, originHeader = origin) => request("/oauth/approve", {
    method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", Origin: originHeader },
    body: new URLSearchParams({ request: id, password })
  });
  const exchange = (code, overrides = {}) => request("/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: callback, resource: origin + "/mcp", ...overrides })
  });
  const consent = async () => {
    const { id } = await begin();
    const approved = await approve(id);
    assert.equal(approved.status, 302);
    const location = new URL(approved.headers.get("location"));
    assert.equal(location.origin + location.pathname, callback);
    assert.equal(location.searchParams.get("state"), "expected-state");
    return location.searchParams.get("code");
  };
  return { auth, request, register, client, begin, approve, exchange, consent };
}

test("OAuth requires an HTTPS origin, a strong owner code, and no tunnel bypass", () => {
  for (const url of ["http://example.com", "https://u:p@example.com", "https://example.com/mcp", "https://example.com?token=x", "https://example.com/#x"]) assert.throws(() => validatePublicUrl(url));
  assert.equal(createClaudeAuth({}), null);
  assert.throws(() => createClaudeAuth({ ZSSH_PUBLIC_URL: origin, ZSSH_OWNER_PASSWORD: "short" }), /32/);
  assert.throws(() => createClaudeAuth({ ZSSH_PUBLIC_URL: origin, ZSSH_OWNER_PASSWORD: ownerPassword, ZSSH_TRUST_LOCAL_TUNNEL: "1" }), /Disable/);
});

test("HTTP discovery, owner consent, PKCE token exchange and protected access", async t => {
  const f = await fixture(t);
  const denied = await f.request("/mcp");
  assert.equal(denied.status, 401);
  assert.ok(denied.headers.get("www-authenticate").includes(origin + "/.well-known/oauth-protected-resource/mcp"));
  const metadata = await (await f.request("/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(metadata.resource, origin + "/mcp");
  const discovery = await (await f.request("/.well-known/oauth-authorization-server")).json();
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
  const code = await f.consent();
  const response = await f.exchange(code);
  assert.equal(response.status, 200, await response.clone().text());
  const token = await response.json();
  const accepted = await f.request("/mcp", { headers: { Authorization: "Bearer " + token.access_token } });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).client, f.client.client_id);
  assert.equal((await f.exchange(code)).status, 400, "authorization codes are single use");
});

test("wrong owner code and cross-origin consent cannot issue authorization codes", async t => {
  const f = await fixture(t);
  const { id, html } = await f.begin();
  assert.ok(!html.includes(ownerPassword));
  assert.equal((await f.approve(id, "wrong")).status, 403);
  assert.equal((await f.approve(id, ownerPassword, "https://attacker.example")).status, 403);
  assert.equal((await f.approve("invented")).status, 400);
  assert.equal((await f.approve(id)).status, 302);
  assert.equal((await f.approve(id)).status, 400, "consent request is single use");
});

test("PKCE, client, redirect and resource binding reject stolen codes", async t => {
  const f = await fixture(t);
  const code = await f.consent();
  const second = await f.register();
  for (const overrides of [
    { code_verifier: "wrong" }, { client_id: second.client_id },
    { redirect_uri: "https://attacker.example/callback" }, { resource: "https://other.example/mcp" }
  ]) assert.equal((await f.exchange(code, overrides)).status, 400);
  assert.equal((await f.exchange(code)).status, 200);
});

test("registration rejects insecure callbacks and authorization rejects arbitrary redirects", async t => {
  const f = await fixture(t);
  const response = await f.request("/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://attacker.example/callback"], token_endpoint_auth_method: "none" })
  });
  assert.equal(response.status, 400);
  const query = new URLSearchParams({ client_id: f.client.client_id, redirect_uri: "https://attacker.example/callback", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
  assert.equal((await f.request("/authorize?" + query, { redirect: "manual" })).status, 400);
});

test("refresh rotates both tokens, binds the client and supports family revocation", async t => {
  const f = await fixture(t);
  const tokens = await (await f.exchange(await f.consent())).json();
  const second = await f.register();
  const refresh = (overrides = {}) => f.request("/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: f.client.client_id, refresh_token: tokens.refresh_token, resource: origin + "/mcp", ...overrides })
  });
  assert.equal((await refresh({ client_id: second.client_id })).status, 400);
  assert.equal((await refresh({ scope: "admin" })).status, 400);
  const rotated = await refresh();
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.equal((await refresh()).status, 400);
  assert.equal((await f.request("/mcp", { headers: { Authorization: "Bearer " + tokens.access_token } })).status, 401);
  await f.auth.provider.revokeToken(second, { token: next.refresh_token });
  assert.equal((await f.request("/mcp", { headers: { Authorization: "Bearer " + next.access_token } })).status, 200);
  const revoked = await f.request("/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: f.client.client_id, token: next.refresh_token })
  });
  assert.equal(revoked.status, 200);
  assert.equal((await f.request("/mcp", { headers: { Authorization: "Bearer " + next.access_token } })).status, 401);
});

test("expired codes and tokens fail closed; sensitive tokens are stored hashed", async () => {
  let time = Date.now();
  const provider = new OwnerOAuthProvider({ publicUrl: origin, ownerPassword, now: () => time });
  const client = provider.registerClient({ redirect_uris: [callback] });
  provider.codes.set(crypto.createHash("sha256").update("expired").digest("hex"), { clientId: client.client_id, params: { codeChallenge: challenge }, expires: time - 1 });
  await assert.rejects(() => provider.challengeForAuthorizationCode(client, "expired"));
  const tokens = provider.issueTokens(client.client_id);
  assert.ok(!provider.tokens.has(tokens.access_token));
  assert.ok(!JSON.stringify([...provider.tokens]).includes(tokens.refresh_token));
  time += 3600001;
  await assert.rejects(() => provider.verifyAccessToken(tokens.access_token));
  time += 7 * 86400000;
  await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token));
});

test("login attempts are limited", async t => {
  const f = await fixture(t);
  const { id } = await f.begin();
  for (let i = 0; i < 10; i++) await f.approve(id, "wrong");
  assert.equal((await f.approve(id)).status, 429);
});
