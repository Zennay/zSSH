import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  bearerChallenge,
  oauthConfigFromEnv,
  protectedResourceMetadata,
  requireScopes,
  verifyOAuthAuthorizationHeader,
} from "../oauth.mjs";

async function withJwksServer(fn) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "zssh-test-key";
  jwk.use = "sig";
  jwk.alg = "RS256";

  const server = createServer((req, res) => {
    if (req.url !== "/jwks") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn({ privateKey, jwksUri: `http://127.0.0.1:${port}/jwks` });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function config(jwksUri = "https://issuer.example/jwks") {
  return {
    issuer: "https://issuer.example",
    resource: "https://mcp.example",
    jwksUri,
    scopes: ["zssh:read", "zssh:write"],
    readScope: "zssh:read",
    writeScope: "zssh:write",
    documentationUrl: "https://example.test/docs",
    policyUrl: "https://example.test/privacy",
    termsUrl: "https://example.test/terms",
  };
}

test("OAuth environment config is fail-closed when incomplete", () => {
  assert.equal(oauthConfigFromEnv({}), null);
  assert.equal(oauthConfigFromEnv({
    ZSSH_OAUTH_ISSUER: "https://issuer.example",
    ZSSH_PUBLIC_BASE_URL: "https://mcp.example",
  }), null);
});

test("protected resource metadata and challenge bind to the canonical resource", () => {
  const cfg = config();
  assert.deepEqual(protectedResourceMetadata(cfg), {
    resource: "https://mcp.example",
    authorization_servers: ["https://issuer.example"],
    scopes_supported: ["zssh:read", "zssh:write"],
    resource_documentation: "https://example.test/docs",
    resource_policy_uri: "https://example.test/privacy",
    resource_tos_uri: "https://example.test/terms",
  });
  const challenge = bearerChallenge(cfg, {
    scope: "zssh:write",
    error: "insufficient_scope",
    errorDescription: "Write access is required",
  });
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource"/);
  assert.match(challenge, /scope="zssh:write"/);
  assert.match(challenge, /error="insufficient_scope"/);
});

test("OAuth verifier checks signature, issuer, audience, expiry and scopes", async () => {
  await withJwksServer(async ({ privateKey, jwksUri }) => {
    const cfg = config(jwksUri);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ scope: "zssh:read zssh:write" })
      .setProtectedHeader({ alg: "RS256", kid: "zssh-test-key" })
      .setIssuer(cfg.issuer)
      .setAudience(cfg.resource)
      .setSubject("user-123")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    const auth = await verifyOAuthAuthorizationHeader("Bearer " + token, cfg);
    assert.equal(auth.clientId, "user-123");
    assert.deepEqual(auth.scopes.sort(), ["zssh:read", "zssh:write"]);
    assert.ok(auth.expiresAt > now);
    assert.equal(requireScopes(auth, ["zssh:read"]), auth);
    assert.throws(() => requireScopes(auth, ["zssh:admin"]), /missing required OAuth scope/);

    const wrongAudience = await new SignJWT({ scope: "zssh:read" })
      .setProtectedHeader({ alg: "RS256", kid: "zssh-test-key" })
      .setIssuer(cfg.issuer)
      .setAudience("https://wrong.example")
      .setSubject("user-123")
      .setExpirationTime(now + 300)
      .sign(privateKey);

    await assert.rejects(
      () => verifyOAuthAuthorizationHeader("Bearer " + wrongAudience, cfg),
      /invalid bearer access token/
    );
  });
});
