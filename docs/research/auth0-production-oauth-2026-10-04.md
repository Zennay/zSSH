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

## Management API origin boundary

For a canonical Auth0 tenant issuer such as `https://tenant.eu.auth0.com/`, zSSH derives the Management API origin from the issuer origin. This removes a redundant non-secret production input while keeping the bearer token bound to the same canonical Auth0 tenant host.

For a custom Auth0 login domain, derivation is intentionally disabled. `AUTH0_MANAGEMENT_BASE_URL` must then be supplied explicitly and must use a canonical `*.auth0.com` tenant hostname. This prevents the protected Management API token from being sent to an arbitrary custom-domain origin.

That hostname check alone is not enough to prove that the public custom issuer and the canonical Management API hostname belong to the same Auth0 tenant. For custom issuers, the production preflight therefore also reads `GET /api/v2/custom-domains` through the canonical Management API and requires the exact issuer hostname to appear exactly once with `status=ready` and `verification.status=verified`. A token for another identically configured Auth0 tenant can no longer satisfy the production check.

Auth0 documents `GET /api/v2/custom-domains` as the Management API source for a tenant's configured custom domains and exposes the domain plus provisioning/verification state in that response:
- https://support.auth0.com/center/s/article/troubleshoot-auth0-custom-domains-issues
- https://auth0.com/blog/custom-domains-complete-guide/

The protected Management API token used with a custom issuer must therefore be authorized to list that tenant's custom domains in addition to the existing tenant-settings, resource-server and client-grant reads.

## Evidence and secret boundary

`scripts/check-auth0-production.mjs` reads the Auth0 Management API with a protected token and emits only non-secret configuration evidence, including whether the management origin was derived. It never prints or persists the management token, reviewer password, OAuth access token, or user data.

The protected `openai-production` release workflow must run this check before the final submission probe. A green bearer-token probe alone is no longer sufficient to prove provider configuration.


## Issuer endpoint provenance hardening — 2026-10-04

OpenAI's current plugin authentication contract requires the authorization-server metadata to provide the authorization and token endpoints used for the authorization-code + PKCE flow, with the selected issuer acting as the canonical authorization-server identity:
- https://developers.openai.com/plugins/build/auth

Auth0 documents that when a custom domain is used for authentication, authorization/token operations must use that same selected domain; tokens carry the issuer of the domain used to obtain them:
- https://auth0.com/docs/customize/custom-domains/configure-features-to-use-custom-domains
- https://auth0.com/docs/secure/tokens/access-tokens/get-access-tokens

**Decision:** the zSSH Auth0 production preflight now fails closed unless `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, and `jwks_uri` all use the exact origin of `ZSSH_OAUTH_ISSUER`. This prevents a syntactically valid but mixed-origin discovery document from passing production readiness and keeps authorization, code exchange, DCR, and signing-key discovery bound to the same Auth0 issuer selected by protected-resource metadata.

This is an Auth0-specific production invariant. The generic OAuth metadata validator remains provider-neutral.
