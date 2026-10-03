# Signed outbound agent HTTP transport — 2026-10-03

## Scope

This increment binds the Ed25519 outbound-agent security core from PR #44 to explicit HTTP endpoints and a target-side polling loop.

It preserves the universal public MCP endpoint architecture from PR #43 and keeps Linux execution on the owner-controlled target.

## Primary sources checked

Checked 2026-10-03:

- OpenAI Remote MCP server review requirements:
  https://developers.openai.com/plugins/deploy/app-review
- OpenAI Authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy

## Platform facts driving the design

- Most public plugins should use one universal public MCP endpoint.
- User access to customer-specific data/write tools must remain protected by OAuth 2.1 and server-side authorization.
- Network integrations must use normal production controls such as TLS verification, input validation, retries and timeouts.
- Secrets should not be placed in tool metadata/results or logged unnecessarily.

## Transport decision

A target agent connects **outbound** to the universal zSSH gateway over HTTPS. The gateway never initiates SSH or arbitrary HTTP calls toward user-supplied hosts.

Agent requests use four signed headers:

- `x-zssh-target-id`
- `x-zssh-agent-timestamp`
- `x-zssh-agent-nonce`
- `x-zssh-agent-signature`

The Ed25519 signature covers:

- HTTP method;
- exact `/agent/v1/...` request path;
- opaque target ID;
- Unix timestamp;
- one-use nonce;
- SHA-256 of the exact raw request body.

The gateway trust file stores only target public keys. Agent private keys remain on the target.

## Endpoints

All endpoints are POST-only and return JSON with `Cache-Control: no-store`.

- `/agent/v1/connect` — establish/replace one live session for the authenticated target.
- `/agent/v1/poll` — bounded long poll for one queued allowlisted tool call.
- `/agent/v1/result` — complete one pending request for the current session.
- `/agent/v1/disconnect` — explicitly disconnect the current session.

Every call is independently signed. Replaying a nonce, using an untrusted target key, changing the body/path, using a stale timestamp, or answering from a superseded session fails closed.

## Body and error policy

- request bodies are bounded before parsing;
- only `application/json` is accepted;
- authentication failures return a generic 401 without signature/key detail;
- malformed signed envelopes return 400;
- stale/current-session conflicts return 409;
- no target IDs, arguments, command results, signatures, keys or nonces are written to the ordinary HTTP access response beyond what the target already supplied;
- agent endpoints are not CORS-enabled and are not part of the public MCP tool scan.

## Target-side loop

The installed target loop:

1. loads one Ed25519 private key from a mode-0600 file;
2. derives/validates its configured opaque `zt_...` target ID;
3. requires an HTTPS gateway base URL outside explicit test mode;
4. connects, long-polls, executes only the existing public target capability subset locally, posts the bounded result, and reconnects with backoff;
5. never sends the private key or local environment to the gateway.

The target loop does not expose a listening socket.

## Boundary

This increment establishes authenticated bidirectional transport but does **not** yet switch public MCP tool handlers from local execution to remote execution. That cutover is a separate increment so the transport can first be tested independently and existing single-target deployments remain unchanged.
