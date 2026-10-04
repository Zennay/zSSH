# Public OAuth gateway deployment boundary — 2026-10-04

## Scope

This decision defines how zSSH deploys the public OpenAI-review gateway without replacing the existing private zSSH service.

## Primary sources checked

Checked 2026-10-04:

- OpenAI Plugins authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI remote MCP review requirements:
  https://developers.openai.com/plugins/deploy/app-review
- OpenAI MCP server guide:
  https://developers.openai.com/plugins/build/mcp-server
- OpenAI security and privacy guidance:
  https://developers.openai.com/plugins/guides/security-privacy

## Current platform constraints

- Public review expects a publicly reachable remote MCP server on a real domain, not a local/testing endpoint.
- Authenticated private data and write actions use OAuth 2.1 authorization-code flow.
- Authorization-server metadata must support PKCE S256.
- The MCP resource server must publish protected-resource metadata and enforce issuer, audience/resource, expiry and scopes on every request.
- OpenAI recommends an established identity provider rather than implementing a new authentication system from scratch.
- The normal public distribution model is one universal MCP URL; template URLs are a restricted path.

## Decision

Deploy the public reviewer gateway as an **isolated user-level service** alongside the existing private gateway:

- service: `zssh-public.service`
- loopback port: 8789 by default
- config: `~/.config/zssh/public-gateway.env` mode 0600
- releases: `~/.local/share/zssh-public/releases/<git-sha>`
- pairing registry: `~/.config/zssh/public-pairings.json`
- raw shell disabled
- public OAuth profile only
- target pairing required
- outbound-agent trust loaded from `ZSSH_AGENT_PUBLIC_KEYS_FILE`
- one explicit opaque `zt_...` reviewer target for the submission fixture

The existing private `zssh.service` and `gateway.env` are not rewritten by this installer.

## Fail-closed deployment rules

The installer refuses to proceed when:

- the public resource is not an HTTPS origin on a DNS hostname;
- issuer or JWKS are not HTTPS;
- the target ID is `local` or absent;
- the target public trust file is missing, a symlink, group/world-writable, malformed, or does not contain the configured target;
- reviewer roots are not absolute;
- the source revision differs from an explicitly requested SHA.

Release contents are exported from the exact tracked Git commit with `git archive`; mutable worktree files are never copied into the release.

A failed service start or local health check restores the prior public-gateway config/release when one exists, otherwise disables the failed new service.

## External responsibility that remains

This installer deliberately does **not**:

- create an OAuth/IdP implementation;
- invent a public hostname or DNS record;
- configure TLS/reverse proxy ingress;
- create reviewer credentials;
- create the OpenAI domain challenge token.

Those values must come from the real production DNS/IdP/OpenAI portal flow. Once supplied, the installer makes the zSSH side deterministic and reproducible.
