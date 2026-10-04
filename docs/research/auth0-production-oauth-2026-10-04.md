# Auth0 production OAuth decision — 2026-10-04

## Decision

Use **Auth0** as the first production authorization-server candidate for zSSH M5, with **Dynamic Client Registration (DCR)** as the required client-registration path. CIMD may be enabled later, but the first release does not depend on Auth0's early-access CIMD toggle.

This is a provider choice, not evidence that a tenant already exists or is configured.

## Primary sources

- OpenAI authentication contract: https://developers.openai.com/plugins/build/auth
- Auth0 Dynamic Client Registration: https://auth0.com/docs/get-started/applications/dynamic-client-registration
- Auth0 tenant settings / resource compatibility: https://auth0.com/docs/api/management/v2/tenants/patch-settings
- Auth0 third-party client grants: https://auth0.com/docs/get-started/applications/third-party-applications/configure-third-party-applications
- Auth0 MCP resource-parameter guidance: https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0

## Required production tenant state

zSSH will fail closed unless the production Auth0 tenant proves all of the following through public discovery plus the Auth0 Management API:

1. DCR is enabled.
2. New DCR clients use `strict` third-party security mode.
3. `resource_parameter_profile` is `compatibility`, so ChatGPT's RFC 8707 `resource` parameter selects the zSSH API audience.
4. RFC 9207 authorization-response issuer identification is enabled and advertised, allowing the stable OpenAI callback path.
5. The exact zSSH API identifier is `https://zssh.cheapgpt.shop`.
6. The API signs access tokens with RS256.
7. The API defines `zssh:read` and `zssh:write`.
8. Exactly one default **user-delegated** third-party client grant exists for that API and grants exactly those two scopes; `allow_all_scopes` is forbidden.
9. Public authorization-server metadata exposes DCR, authorization code, PKCE S256 and a public JWKS URI.

## Evidence and secret boundary

`scripts/check-auth0-production.mjs` reads the Auth0 Management API with a protected token and emits only non-secret configuration evidence. It never prints or persists the management token, reviewer password, OAuth access token, or user data.

The protected `openai-production` release workflow must run this check before the final submission probe. A green bearer-token probe alone is no longer sufficient to prove provider configuration.
