# Private revocable client-token separation — 2026-10-03

## Primary sources reviewed

- OpenAI Authentication: https://developers.openai.com/plugins/build/auth
- OpenAI MCP server guide: https://developers.openai.com/plugins/build/mcp-server
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review

## Decision

zSSH may support revocable local client credentials for **private/self-hosted** connections, but those credentials are not an alternative authentication path for the public OpenAI profile.

For the public profile, OAuth remains authoritative and exclusive: the resource server verifies the OpenAI/MCP OAuth access token, scopes, and local target pairing. A local zSSH client token must never let a caller bypass that public OAuth branch.

For the private profile, a target owner may create multiple independent client tokens locally. zSSH stores only SHA-256 token hashes, lists only token IDs/labels/timestamps, and revokes one token without changing other credentials. A capability URL containing a local token is itself a secret and is intended only for private self-hosted clients.

This separation preserves the reviewed public auth contract while giving private installations revocable credentials instead of one long-lived global bearer/API/capability secret.
