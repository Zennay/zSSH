import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksCache = new Map();

function splitScopes(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
}

function ensureAbsoluteUrl(value, name) {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(name + " must be an absolute URL");
  }
}

export function oauthConfigFromEnv(env = process.env) {
  const issuer = String(env.ZSSH_OAUTH_ISSUER || "").trim();
  const resource = String(env.ZSSH_PUBLIC_BASE_URL || "").trim();
  const jwksUri = String(env.ZSSH_OAUTH_JWKS_URI || "").trim();
  const scopes = splitScopes(env.ZSSH_OAUTH_SCOPES || "zssh:read zssh:write");

  if (!issuer || !resource || !jwksUri) return null;

  return Object.freeze({
    issuer: ensureAbsoluteUrl(issuer, "ZSSH_OAUTH_ISSUER"),
    resource: ensureAbsoluteUrl(resource, "ZSSH_PUBLIC_BASE_URL"),
    jwksUri: ensureAbsoluteUrl(jwksUri, "ZSSH_OAUTH_JWKS_URI"),
    scopes: [...new Set(scopes)],
    readScope: String(env.ZSSH_OAUTH_READ_SCOPE || "zssh:read").trim(),
    writeScope: String(env.ZSSH_OAUTH_WRITE_SCOPE || "zssh:write").trim(),
    documentationUrl: String(env.ZSSH_OAUTH_DOCUMENTATION_URL || "https://github.com/Zennay/zSSH/blob/main/README.md").trim(),
    policyUrl: String(env.ZSSH_OAUTH_POLICY_URL || "https://github.com/Zennay/zSSH/blob/main/PRIVACY.md").trim(),
    termsUrl: String(env.ZSSH_OAUTH_TERMS_URL || "https://github.com/Zennay/zSSH/blob/main/TERMS.md").trim(),
  });
}

export function protectedResourceMetadata(config) {
  if (!config) throw new Error("OAuth is not configured");
  const value = {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: config.scopes,
  };
  if (config.documentationUrl) value.resource_documentation = config.documentationUrl;
  if (config.policyUrl) value.resource_policy_uri = config.policyUrl;
  if (config.termsUrl) value.resource_tos_uri = config.termsUrl;
  return value;
}

export function protectedResourceMetadataUrl(config) {
  if (!config) throw new Error("OAuth is not configured");
  return new URL("/.well-known/oauth-protected-resource", config.resource + "/").toString();
}

export function bearerChallenge(config, { scope, error, errorDescription } = {}) {
  const parts = [
    'Bearer resource_metadata="' + protectedResourceMetadataUrl(config) + '"',
  ];
  if (scope) parts.push('scope="' + String(scope).replace(/["\\]/g, "") + '"');
  if (error) parts.push('error="' + String(error).replace(/["\\]/g, "") + '"');
  if (errorDescription) parts.push('error_description="' + String(errorDescription).replace(/["\\]/g, "") + '"');
  return parts.join(", ");
}

function remoteJwks(uri) {
  if (!jwksCache.has(uri)) {
    jwksCache.set(uri, createRemoteJWKSet(new URL(uri)));
  }
  return jwksCache.get(uri);
}

export async function verifyOAuthAuthorizationHeader(header, config) {
  if (!config) throw new Error("OAuth is not configured");
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  if (!match) {
    const error = new Error("missing bearer access token");
    error.code = "invalid_token";
    throw error;
  }

  try {
    const token = match[1];
    const { payload } = await jwtVerify(token, remoteJwks(config.jwksUri), {
      issuer: config.issuer,
      audience: config.resource,
      clockTolerance: 5,
    });

    const scopes = [...new Set([
      ...splitScopes(payload.scope),
      ...splitScopes(payload.scp),
    ])];
    const clientId = String(payload.azp || payload.client_id || payload.sub || "").trim();
    const expiresAt = Number(payload.exp);

    if (!Number.isFinite(expiresAt)) {
      const error = new Error("access token has no valid exp claim");
      error.code = "invalid_token";
      throw error;
    }

    return {
      token,
      clientId,
      scopes,
      expiresAt,
      extra: {
        sub: payload.sub || null,
        issuer: payload.iss || null,
        audience: payload.aud || null,
      },
    };
  } catch (cause) {
    if (cause?.code === "invalid_token") throw cause;
    const error = new Error("invalid bearer access token");
    error.code = "invalid_token";
    error.cause = cause;
    throw error;
  }
}

export function requireScopes(authInfo, requiredScopes) {
  const required = [...new Set((requiredScopes || []).filter(Boolean))];
  const available = new Set(authInfo?.scopes || []);
  const missing = required.filter(scope => !available.has(scope));
  if (missing.length) {
    const error = new Error("missing required OAuth scope: " + missing.join(" "));
    error.code = "insufficient_scope";
    error.requiredScopes = required;
    throw error;
  }
  return authInfo;
}
