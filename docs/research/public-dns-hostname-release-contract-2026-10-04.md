# Public DNS hostname release contract — 2026-10-04

## Current platform requirement

OpenAI's current remote-MCP guidance requires a stable, publicly reachable HTTPS endpoint for public plugin submission. The review requirements further describe the production server as hosted on a publicly accessible domain, with domain verification performed during submission.

Primary sources:
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/plugins/deploy/submission

## Gap

The central zSSH release URL validator rejected loopback/private/reserved hosts but still accepted globally routable IPv4 or IPv6 literals whenever `requirePublicHostname` was enabled. Other M5 checks already required DNS hostnames, so the central release/probe contract was weaker than the protected readiness contract.

That created validation drift: an IP-literal MCP or OAuth URL could pass the central release contract even though it could not satisfy the intended domain-based production/submission posture.

## Decision

When `requirePublicHostname` is enabled, reject every IPv4 or IPv6 literal before accepting an MCP endpoint, OAuth issuer, or OAuth metadata endpoint. Development can still opt out through the existing test-only `requirePublicHostname: false` / `allowHttp` paths.

## Evidence

Regression coverage asserts that both public IPv4 and IPv6 MCP URLs fail closed and that OAuth authorization-server metadata using an IP-literal issuer fails the same public-hostname contract.


## Single-label hostname follow-up

The central release validator also now rejects single-label hostnames such as `https://intranet/mcp` when `requirePublicHostname` is enabled. Protected readiness and the submission builder already enforced this shape, so accepting a single-label MCP or OAuth host in the central release/probe contract was validation drift.

Regression coverage now proves both the MCP endpoint and OAuth authorization-server metadata fail closed for single-label hosts. Development-only opt-outs remain unchanged.
