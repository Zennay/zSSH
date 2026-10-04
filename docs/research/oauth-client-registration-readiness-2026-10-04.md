# OAuth client registration readiness — 2026-10-04

## Source
OpenAI Authentication guidance: https://developers.openai.com/plugins/build/auth

## Current platform contract
OpenAI hosts can identify/register as an OAuth client through Client ID Metadata Documents (CIMD), dynamic client registration (DCR), or a predefined OAuth client. The public authorization-server metadata must still expose the authorization-code flow, PKCE S256, and token endpoint authentication methods. OpenAI currently prefers CIMD when supported and continues to support DCR.

OpenAI also uses RFC 9207 issuer identification when available to support stable OAuth callbacks and stable CIMD client identity. That signal improves deployment stability, but absence alone does not make an otherwise supported OAuth flow invalid because callback-specific behavior remains available.

## zSSH decision
For the first public zSSH release, production OAuth discovery must advertise at least one self-describing ChatGPT client path that can be proven from the public metadata: CIMD or DCR. zSSH will not mark the production submission probe green for an authorization server that exposes neither.

This deliberately excludes a hidden/predefined-client-only assumption from automated green evidence. If zSSH later chooses a predefined OAuth client, that should be introduced as an explicit reviewed release mode with its own protected configuration and proof rather than silently bypassing discovery validation.

The production submission probe records:
- whether CIMD is advertised;
- whether DCR is advertised;
- the resulting supported client-registration methods;
- whether RFC 9207 issuer identification is advertised.

No client secret, reviewer credential, access token, or provider-private configuration is stored in repository evidence.
