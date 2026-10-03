# Outbound target-agent authentication and broker — 2026-10-03

## Scope

This ADR defines authentication and request isolation for the future outbound zSSH target-agent transport behind the universal public MCP endpoint.

It builds on `docs/research/universal-endpoint-routing-2026-10-03.md`.

## Primary sources checked

Checked 2026-10-03:

- OpenAI Authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Remote MCP review requirements:
  https://developers.openai.com/plugins/deploy/app-review
- RFC 6750 — Bearer Token Usage:
  https://datatracker.ietf.org/doc/html/rfc6750

## Separation of identities

There are two different authentication boundaries:

1. **User OAuth** authenticates the ChatGPT user to the public zSSH MCP resource.
2. **Agent authentication** authenticates one owner-controlled Linux target to the zSSH gateway.

An agent token is never accepted as a user OAuth credential and a user OAuth token is never accepted as an agent credential.

## Agent credential decision

Each target gets a revocable high-entropy bearer credential:

- token is shown once when created;
- gateway persists only SHA-256 of the full token;
- store is mode 0600 in a mode 0700 directory;
- stored record is bound to one opaque `zt_...` target ID;
- verification uses timing-safe hash comparison;
- revocation takes effect on the next request/reconnect;
- token is sent only in the HTTP `Authorization: Bearer` header;
- token must never be placed in URL path/query, logs, pairing state, MCP output, or plugin package.

The eventual production agent transport must use HTTPS and validate the TLS certificate chain.

## Broker decision

The gateway request broker is bounded and target-isolated:

- queue items are keyed by opaque target ID;
- an agent can poll only its authenticated target queue;
- an agent cannot complete another target's request;
- request IDs are opaque random values;
- tool names are bounded and validated;
- serialized request arguments are size-limited;
- per-target and global pending-request limits apply;
- every request has a hard timeout;
- timeout/removal fails closed instead of rerouting to another target;
- diagnostic snapshots contain counts/IDs only, never tool arguments or results.

## No central execution capability

The gateway broker is not a shell and does not interpret tool arguments. It only transports a bounded zSSH tool request to the authenticated target session selected by the pairing/router layer.

Linux execution policy remains on the target:

- public tool allowlist;
- allowed filesystem roots;
- scoped sudo policy;
- secret-content rejection;
- command timeout/output limits;
- local audit.

## Increment delivered by this ADR

This increment adds:

- revocable target-bound agent credential store;
- local CLI lifecycle for agent credentials;
- bounded in-memory request broker;
- regression tests for hash-only storage, revocation, cross-target isolation, limits and timeout.

The following increment will wire these primitives to HTTPS long-poll/result endpoints and a target-side agent loop.
