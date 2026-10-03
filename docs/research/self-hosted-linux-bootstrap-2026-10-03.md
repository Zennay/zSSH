# Generic self-hosted Linux bootstrap decision — 2026-10-03

## Current primary-source check

Reviewed on 2026-10-03:

- OpenAI MCP server guide: https://developers.openai.com/plugins/build/mcp-server
- OpenAI authentication guide: https://developers.openai.com/plugins/build/auth
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review

Current OpenAI guidance still requires a production plugin MCP server to use Streamable HTTP at a stable publicly reachable HTTPS endpoint. Private data and write actions must be authorized server-side; authenticated public plugins use the MCP OAuth 2.1 contract, including protected-resource metadata and per-tool security schemes. Review scans the live MCP tool metadata advertised by the submitted endpoint.

## Engineering decision

Add a provider-agnostic Linux bootstrap without changing the public-plugin authorization model.

The generic bootstrap is an installation primitive for a user-controlled Linux target. It:

- runs only as an unprivileged user;
- installs an immutable checked-out Git revision through the existing `deploy/install-live.sh` path;
- keeps the zSSH process loopback-bound;
- defaults file access to a dedicated `~/zssh-workspace` when the operator has not configured `ZSSH_ALLOWED_ROOTS`;
- does not enable raw shell;
- does not weaken the existing public OAuth, pairing, scope, or review-profile checks;
- does not claim that an arbitrary per-user self-hosted endpoint is by itself a universal public Directory distribution model.

HTTPS exposure and production OAuth remain separate deployment concerns. Public submission continues to require the stable reviewed endpoint and current OAuth/review contract. The new bootstrap only removes the old account/VPS-specific installation assumption from the target runtime.

## Diagnostic boundary

The generic diagnostic helper may print target identity, service state, health, filesystem roots, profile/auth mode, and other non-secret operational settings. It must not print bearer tokens, API keys, capability tokens, OAuth tokens, challenge tokens, or raw environment-file contents.
