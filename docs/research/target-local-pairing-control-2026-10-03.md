# Target-local pairing control over the outbound agent — 2026-10-03

## Sources checked

- OpenAI Security & Privacy: https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Authentication: https://developers.openai.com/plugins/build/auth
- OpenAI Remote MCP server review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI Build an MCP server: https://developers.openai.com/plugins/build/mcp-server

## Platform constraints relevant to zSSH

OpenAI's current guidance requires server-side authorization on every request, least-privilege permissions, defense in depth, explicit account linking/consent, and a publicly reachable universal MCP endpoint for the normal public-review path. Reviewers must be able to use the provided authenticated demo flow without hidden target-network setup.

For zSSH, OAuth proves the ChatGPT user's profile identity, but it must not itself grant that profile access to a Linux target. The target owner remains the authority that approves or revokes a profile→target pairing.

## Decision

Pairing administration for a universal gateway uses the already authenticated target-agent channel rather than a public MCP tool or gateway-local shell command.

A target owner runs the local `agent.mjs` CLI with the target's Ed25519 private key:

- `node agent.mjs pairings`
- `node agent.mjs approve <pairing-request-id>`
- `node agent.mjs revoke <profile-id>`

These commands POST to signed `/agent/v1/...` control endpoints. The same timestamp, nonce, exact-body signature and replay protections used by the target transport apply. The gateway derives the authoritative target ID from the verified agent signature, never from the request body.

## Authorization invariants

1. Listing is filtered to the signed target ID.
2. Approval succeeds only if the pending request belongs to the signed target ID.
3. Revocation is scoped to the signed target ID.
4. Pairing controls are not MCP tools and therefore cannot be invoked by the model or by an OAuth profile.
5. The gateway stores only target public keys; the target private key stays local.
6. Public MCP calls still require both a valid OAuth identity and an active approved profile→target pairing.
7. Revocation takes effect on the next MCP routing decision; it does not depend on restarting the agent.
8. Raw OAuth subject values are not returned by pairing-control responses; only opaque hashed profile IDs and pairing/request metadata are exposed to the target owner.

## Threats addressed

- **Cross-target approval:** a signed target cannot approve another target's pending request.
- **Cross-target revocation:** a signed target cannot revoke another target's pairing.
- **Model self-approval:** no public MCP tool can approve or revoke access.
- **Replay:** signed control requests use the agent replay cache.
- **Target spoofing:** target ID is signature-bound and resolved from the verified key.
- **Gateway SSH-key custody:** no SSH or target private key is introduced.

## Release implication

This closes the architectural gap between the universal public MCP endpoint and the existing invariant that pairing approval remains local to the Linux target. Remaining release gates are operational/external: production OAuth/IdP and reviewer account, a reviewer-accessible production target fixture, current portal Scan Tools/domain verification, demo recording, desktop/mobile UI review, and final Directory submission.
