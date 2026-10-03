# Authenticated outbound agent transport — 2026-10-03

## Scope

This research note defines the next executable slice after the universal-endpoint routing core: an authenticated, outbound-only target-agent transport that can carry a bounded public tool call from the zSSH gateway to the paired Linux target without putting SSH credentials or target URLs in the public MCP request.

This increment intentionally stops at a transport core. HTTP endpoint binding and target-agent process integration remain follow-up work so the security boundary can be tested independently first.

## Primary sources checked

Checked on 2026-10-03:

- OpenAI — Build an MCP server:
  https://developers.openai.com/plugins/build/mcp-server
- OpenAI — Authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI — Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy
- OpenAI — Plugin guidelines:
  https://developers.openai.com/plugins/app-guidelines
- RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA):
  https://www.rfc-editor.org/rfc/rfc8032

## Constraints carried into the design

OpenAI's production MCP guidance requires a stable HTTPS MCP endpoint, server-side authorization for private/write operations, strict input validation, accurate tool behavior and least-privilege data handling. The public zSSH gateway therefore cannot rely on a user-provided target URL or on the model to enforce target authorization.

The existing zSSH ADR already fixes the public routing model:

1. OAuth authenticates the ChatGPT user.
2. Local pairing binds the opaque OAuth-derived profile ID to an opaque target ID.
3. The gateway resolves only a live authenticated target-agent session for that target ID.
4. Target execution remains under the target's local Linux permissions and policy.

The missing boundary was how a live outbound agent proves that it owns the configured target identity and how a gateway tool call is moved through that session without silently reopening arbitrary shell.

## Decision

### 1. Agent identity uses asymmetric keys

Each target agent owns an Ed25519 private key locally. The gateway trust store contains only the corresponding public key mapped to the opaque zt_ target ID.

Consequences:

- the gateway does not need an SSH private key, sudo password, target login password or reusable target bearer secret;
- copying the gateway trust store does not give an attacker the ability to impersonate the target agent;
- target rotation can be implemented by replacing one public key entry.

### 2. Every agent HTTP request is signed

The transport core defines a canonical request envelope containing:

- protocol version;
- HTTP method;
- agent path;
- opaque target ID;
- Unix timestamp;
- high-entropy nonce;
- SHA-256 hash of the request body.

The agent signs this canonical value with Ed25519. The gateway validates the configured public key, enforces a bounded clock skew and consumes the nonce exactly once.

This is deliberately an internal zSSH protocol, not a claim of generic HTTP Message Signatures compliance.

### 3. Live routing remains in memory

A connected agent receives a fresh opaque sess_ session ID. Reconnect replaces the old session for that target. A stale disconnect or stale response cannot remove or answer for the replacement session.

Restarting the gateway drops live sessions and therefore fails closed until the target reconnects.

### 4. Tool forwarding is allowlisted

The transport core accepts only the current public target-operation subset:

- get_system_uptime
- get_system_identity
- get_kernel_info
- get_disk_usage
- get_memory_usage
- zssh_read_file
- zssh_write_file

Gateway-local identity/pairing metadata tools are not forwarded. Generic executors such as zssh_exec are explicitly outside this allowlist.

Payloads, responses and waits are bounded. Each forwarded call gets an opaque rpc_ request ID and a hard timeout.

### 5. Outbound long-poll shape

The broker exposes a transport-neutral queue primitive suitable for an outbound HTTPS target agent:

- connect/register one live session;
- long-poll for the next command;
- post one bounded response;
- disconnect/reconnect safely.

A later increment will bind these primitives to concrete /agent/... HTTPS handlers and the installed target-agent process. The MCP endpoint itself remains the single stable public /mcp resource.

## Security invariants

- No target hostname or user-supplied target URL is accepted by the routing/transport layer.
- Agent private keys stay on the target.
- Gateway persistent trust data contains public keys only.
- Signed requests reject stale timestamps, unknown targets, invalid signatures and replayed nonces.
- Only one current live session exists per target ID.
- New sessions invalidate stale response authority.
- Public tool forwarding remains narrower than the private/self-hosted zSSH surface.
- Tool/result payloads and waiting time are bounded.
- Pairing revocation remains authoritative even while an agent session is live.

## Increment delivered

The repository now has:

- agent-transport.mjs: Ed25519 request verification, replay protection and an in-memory outbound-agent command broker;
- test/agent-transport.test.mjs: authentication, replay, stale-session, allowlist, OAuth-pairing-route and revocation coverage.

## Next implementation step

Wire the transport core into explicit HTTPS agent endpoints and a target-side agent loop, then run an exact-head VPS proof showing:

1. the target initiates the connection outbound;
2. a paired OAuth profile can execute one allowed public read tool through the agent;
3. an unpaired/revoked profile is rejected;
4. zssh_exec cannot cross the public transport;
5. agent reconnect invalidates stale responses.
