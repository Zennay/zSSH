# Universal public endpoint routing — 2026-10-03

## Scope

This ADR defines the first executable routing primitive for a single stable public zSSH MCP URL while preserving the self-hosted target-agent security model.

It does **not** introduce a central SSH client, SSH-key store, sudo-secret store, or arbitrary command relay.

## Current primary sources checked

- OpenAI Remote MCP server review requirements:
  https://developers.openai.com/plugins/deploy/app-review
- OpenAI Authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Plugin Guidelines:
  https://developers.openai.com/plugins/plugin-guidelines

Checked: 2026-10-03.

## Platform constraint

OpenAI's normal public Directory model expects one universal production MCP URL that works for all users and organizations. Template MCP URLs are supported only for trusted developers with an established relationship.

Authenticated customer-specific/write tools are expected to use MCP OAuth 2.1, and the resource identifier is the canonical MCP resource rather than a per-target query parameter.

## Decision

zSSH will keep a single public MCP resource URL and route **inside** the service:

1. OAuth identifies the caller and yields the existing opaque zSSH profile ID.
2. Local pairing binds that opaque profile ID to an opaque target ID.
3. A live target-agent session registry resolves only that opaque target ID.
4. Tool execution is forwarded only to the resolved live target session.
5. Target execution remains local under the target's Linux user, filesystem roots, scoped sudo policy, and audit controls.

The public MCP URL never contains a target ID or user-controlled target URL.

## Persistent versus ephemeral state

Persistent gateway state may contain:

- opaque hashed profile ID;
- opaque target ID;
- pairing timestamps/revocation state.

Persistent gateway state must not contain:

- SSH private keys;
- sudo passwords;
- target login passwords;
- arbitrary bearer/client secrets for the target;
- user-supplied target URLs used as SSRF destinations.

Live target transport state is process-memory only and contains an opaque session ID plus the already-authenticated transport object. Reconnect replaces the live session. Restart drops live sessions and fails closed until agents reconnect.

## Backwards compatibility

Existing single-target installations have no `ZSSH_TARGET_ID`. They use the reserved target ID `local`.

New multi-target/public-gateway deployments must configure stable opaque IDs such as `zt_abcd1234...`. Pairing records created before target-aware routing remain valid only for the reserved `local` target.

## Fail-closed invariants

- A profile paired to target A cannot resolve target B.
- Revoked pairing cannot resolve a target.
- A paired target without a live agent session is unavailable, not silently rerouted.
- Multiple profiles may pair to the same target only through explicit local approvals.
- The route resolver never accepts a target URL from an MCP request.
- Live session snapshots expose opaque IDs/status only, never transport objects or credentials.

## Increment delivered by this ADR

This change makes the pairing registry target-aware and adds an in-memory live target-session router. It is the routing/security core required before an outbound agent transport is connected to the universal gateway.

A later increment will add the authenticated outbound agent transport and tool forwarding on top of this fail-closed primitive.
