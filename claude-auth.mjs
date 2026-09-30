import crypto from "node:crypto";
import express from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError, InvalidClientMetadataError, TooManyRequestsError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const SCOPE = "zssh:operate";
const random = () => crypto.randomBytes(32).toString("base64url");
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function validatePublicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("ZSSH_PUBLIC_URL must be an HTTPS origin, for example https://zssh.your-domain.nl");
  }
  return url;
}

// Single-owner private VPS authorization. State is deliberately in memory:
// restarting the service revokes every grant and requires clients to reconnect.
export class OwnerOAuthProvider {
  constructor({ publicUrl, ownerPassword, now = Date.now, log = entry => console.info(JSON.stringify(entry)) }) {
    this.issuer = validatePublicUrl(publicUrl);
    if (typeof ownerPassword !== "string" || ownerPassword.length < 32 || ownerPassword.length > 512) {
      throw new Error("ZSSH_OWNER_PASSWORD must contain 32 to 512 characters; generate a random owner connection code");
    }
    this.ownerHash = hash(ownerPassword);
    this.resource = new URL("/mcp", this.issuer).href;
    this.now = now;
    this.log = log;
    this.clients = new Map();
    this.pending = new Map();
    this.codes = new Map();
    this.tokens = new Map();
    this.loginWindow = { start: now(), attempts: 0 };
    this.clientsStore = {
      getClient: id => {
        this.prune();
        return this.clients.get(id)?.client;
      },
      registerClient: client => this.registerClient(client)
    };
  }

  prune() {
    for (const map of [this.clients, this.pending, this.codes, this.tokens]) {
      for (const [key, value] of map) if (value.expires <= this.now()) map.delete(key);
    }
  }

  reserve(map, max) {
    this.prune();
    if (map.size >= max) throw new TooManyRequestsError("Connection limit reached; try again later");
  }

  registerClient(metadata) {
    this.reserve(this.clients, 128);
    if (!metadata.redirect_uris?.length || metadata.redirect_uris.length > 8) {
      throw new InvalidClientMetadataError("Register between one and eight redirect URIs");
    }
    for (const value of metadata.redirect_uris) {
      const uri = new URL(value);
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname);
      if ((uri.protocol !== "https:" && !(uri.protocol === "http:" && loopback)) || uri.username || uri.password || uri.hash) {
        throw new InvalidClientMetadataError("Redirect URIs require HTTPS or a loopback HTTP address");
      }
    }
    const client = { ...metadata, client_id: random(), client_id_issued_at: Math.floor(this.now() / 1000) };
    this.clients.set(client.client_id, { client, expires: this.now() + 30 * 86400000 });
    return client;
  }

  checkResource(resource) {
    if (resource && resource.href !== this.resource) throw new InvalidTargetError("Wrong zSSH resource");
  }

  checkScopes(scopes) {
    if (scopes?.some(scope => scope !== SCOPE)) throw new InvalidScopeError("Unsupported zSSH scope");
  }

  async authorize(client, params, res) {
    this.checkResource(params.resource);
    this.checkScopes(params.scopes);
    this.reserve(this.pending, 256);
    const id = random();
    this.pending.set(id, { clientId: client.client_id, params, expires: this.now() + 900000, failures: 0 });
    this.log({ event: "zssh_consent_created", request_ref: hash(id).slice(0, 12), pid: process.pid, at: new Date(this.now()).toISOString(), valid_seconds: 900 });
    res.set({
      "Cache-Control": "no-store",
      // no-referrer turns a browser form POST's Origin into null (notably Safari).
      // same-origin keeps consent POSTs verifiable without leaking URLs off-site.
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff"
    });
    res.type("html").send(`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verbind met zSSH</title><body>
<h1>Verbind met jouw VPS</h1><p><strong>${escapeHtml(client.client_name || "MCP-client")}</strong> vraagt toegang tot ${escapeHtml(this.issuer.hostname)}.</p>
<p>Hiermee kan de client serverinformatie lezen, toegestane opdrachten uitvoeren en bestanden binnen jouw ingestelde mappen lezen en wijzigen. De ingestelde serverrechten blijven gelden.</p>
<form method="post" action="/oauth/approve"><input type="hidden" name="request" value="${id}"><label>Jouw zSSH-verbindingscode <input type="password" name="password" required maxlength="512" autocomplete="off"></label><p>Deze code staat op je VPS in de zSSH-instellingen. Vul hem hier in om deze verbinding toe te staan.</p><button type="submit">Verbinden toestaan</button></form></body></html>`);
  }

  approve(req, res) {
    // No authenticated browser session is reused; each consent needs the owner
    // code and an unguessable, expiring request ID. Also reject cross-site POSTs.
    if (req.headers.origin !== this.issuer.origin) return res.status(403).send("Open het verbindingsscherm opnieuw.");
    if (this.now() - this.loginWindow.start >= 60000) this.loginWindow = { start: this.now(), attempts: 0 };
    if (++this.loginWindow.attempts > 10) return res.status(429).send("Te veel pogingen. Probeer over een minuut opnieuw.");
    const id = req.body?.request;
    const pending = typeof id === "string" ? this.pending.get(id) : undefined;
    const reason = typeof id !== "string" ? "missing_form_request" : !pending ? "request_not_found" : pending.expires <= this.now() ? "expired" : "valid";
    this.log({ event: "zssh_consent_submitted", request_ref: typeof id === "string" ? hash(id).slice(0, 12) : null, pid: process.pid, at: new Date(this.now()).toISOString(), reason });
    this.prune();
    const request = this.pending.get(id);
    if (!request) return res.status(400).send(reason === "expired"
      ? "Dit verbindingsverzoek is verlopen na 15 minuten. Verbind opnieuw vanuit Claude."
      : "Dit verbindingsverzoek is niet meer beschikbaar. Start een nieuwe verbinding vanuit Claude; teruggaan naar een oud formulier herstelt het verzoek niet.");
    const supplied = req.body?.password;
    const correct = typeof supplied === "string" && supplied.length <= 512 && crypto.timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(this.ownerHash));
    if (!correct) {
      if (++request.failures >= 5) this.pending.delete(req.body.request);
      return res.status(403).send("Verbindingscode klopt niet. Start de verbinding opnieuw vanuit Claude.");
    }
    this.reserve(this.codes, 256);
    this.pending.delete(req.body.request);
    const code = random();
    this.codes.set(hash(code), { ...request, expires: this.now() + 60000 });
    const callback = new URL(request.params.redirectUri);
    callback.searchParams.set("code", code);
    if (request.params.state !== undefined) callback.searchParams.set("state", request.params.state);
    return res.redirect(302, callback.href);
  }

  getCode(client, code) {
    this.prune();
    const entry = this.codes.get(hash(code));
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError("Invalid or expired authorization code");
    return entry;
  }

  async challengeForAuthorizationCode(client, code) {
    return this.getCode(client, code).params.codeChallenge;
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const entry = this.getCode(client, code);
    if (redirectUri !== entry.params.redirectUri) throw new InvalidGrantError("Redirect URI does not match");
    this.checkResource(resource);
    this.codes.delete(hash(code));
    return this.issueTokens(client.client_id);
  }

  issueTokens(clientId, family = random()) {
    this.reserve(this.tokens, 1022);
    const access = random();
    const refresh = random();
    this.tokens.set(hash(access), { kind: "access", clientId, family, expires: this.now() + 3600000 });
    this.tokens.set(hash(refresh), { kind: "refresh", clientId, family, expires: this.now() + 7 * 86400000 });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: SCOPE };
  }

  removeFamily(family) {
    for (const [key, value] of this.tokens) if (value.family === family) this.tokens.delete(key);
  }

  async exchangeRefreshToken(client, token, scopes, resource) {
    this.prune();
    const entry = this.tokens.get(hash(token));
    if (!entry || entry.kind !== "refresh" || entry.clientId !== client.client_id) throw new InvalidGrantError("Invalid or expired refresh token");
    this.checkResource(resource);
    this.checkScopes(scopes);
    this.removeFamily(entry.family);
    return this.issueTokens(client.client_id, entry.family);
  }

  async verifyAccessToken(token) {
    this.prune();
    const entry = this.tokens.get(hash(token));
    if (!entry || entry.kind !== "access") throw new InvalidTokenError("Invalid or expired zSSH token");
    return { token, clientId: entry.clientId, scopes: [SCOPE], expiresAt: Math.floor(entry.expires / 1000), resource: this.resource };
  }

  async revokeToken(client, request) {
    const entry = this.tokens.get(hash(request.token));
    if (entry?.clientId === client.client_id) this.removeFamily(entry.family);
  }
}

export function createClaudeAuth(env = process.env) {
  if (!env.ZSSH_PUBLIC_URL) return null;
  if (env.ZSSH_TRUST_LOCAL_TUNNEL === "1") {
    throw new Error("Disable ZSSH_TRUST_LOCAL_TUNNEL before enabling the public Claude connector");
  }
  const provider = new OwnerOAuthProvider({ publicUrl: env.ZSSH_PUBLIC_URL, ownerPassword: env.ZSSH_OWNER_PASSWORD });
  const router = express.Router();
  router.use(mcpAuthRouter({
    provider,
    issuerUrl: provider.issuer,
    resourceServerUrl: new URL(provider.resource),
    scopesSupported: [SCOPE],
    resourceName: "zSSH VPS"
  }));
  router.post("/oauth/approve", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    try { provider.approve(req, res); }
    catch { res.status(429).send("Te veel verbindingen. Probeer later opnieuw."); }
  });
  return {
    router, provider,
    authenticate: requireBearerAuth({ verifier: provider, requiredScopes: [SCOPE], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(provider.resource)) })
  };
}
