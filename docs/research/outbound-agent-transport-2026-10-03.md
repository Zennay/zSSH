# Signed outbound target-agent transport — 2026-10-03

## Context

The universal public MCP endpoint now has target-aware pairing and an in-memory target-session router, but a real public deployment still needs the Linux target to establish the live route without giving the gateway SSH private keys, sudo passwords, or arbitrary target URLs.

## Decision

Use a target-initiated HTTPS long-poll transport authenticated with one Ed25519 keypair per target.

- The **target keeps the private key**.
- The gateway stores only the corresponding public key.
- Every agent POST is bound to the HTTP method, fixed agent endpoint, opaque target ID, timestamp, nonce, and SHA-256 hash of the exact request body.
- The gateway accepts only a short clock-skew window and rejects nonce replay.
- Opening a new authenticated session replaces only the previous session for that same target.
- Public MCP calls are routed through the already paired target session. If no authenticated session is live, the tool fails closed as target offline.
- Agent command forwarding is limited to the existing public zSSH tool surface. Raw shell and the private Git/systemd capabilities are not available through the public agent runtime.

## Endpoints

All endpoints are POST-only and are intentionally separate from the public MCP OAuth path:

- `/agent/v1/session` — create/replace one authenticated live session.
- `/agent/v1/poll` — long-poll for the next bounded tool request.
- `/agent/v1/result` — return one bounded result.
- `/agent/v1/disconnect` — remove the current session.

The target ID comes from the signed agent headers, never from an MCP request or a user-controlled URL.

## Security properties

- No SSH private-key custody at the gateway.
- No target password or sudo secret crosses the transport.
- No user-controlled callback URL or SSRF destination is accepted.
- Agent public keys are non-secret and can be rotated independently per target.
- Request and response payloads are size-bounded.
- Pending requests are bounded per target and have a hard timeout.
- Stale sessions cannot disconnect a newer replacement session.
- Replay, stale timestamp, unknown target, invalid signature, and inactive-session cases fail closed.
- Public file operations retain the existing narrow allowed-root and secret-content/path checks on the target itself.

## Current limitation

This increment intentionally keeps the existing single configured `ZSSH_TARGET_ID` selection semantics for the current public release candidate. The transport and registry are target-aware, but user-facing multi-target selection is not introduced here. That avoids expanding the public review surface before the first Directory submission.

## Validation

CI must cover:

- signature body binding;
- replay rejection;
- clock-skew rejection;
- live forwarding through the current target session;
- session replacement and stale-session rejection;
- bounded long-poll behavior;
- syntax validation for gateway and agent modules;
- the existing complete zSSH security, OAuth, pairing, submission-contract, reproducible-bundle, reviewer-fixture, and production-readiness suites.
