# Public OAuth rate limiting — 2026-10-04

## Current primary-source check

OpenAI's current MCP server guidance says production endpoints should apply timeouts and rate limits to expensive or externally visible tools, alongside production authentication, secret management and safe logging:

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/guides/security-privacy
- https://developers.openai.com/plugins/build/auth

The auth guide also makes the resource server responsible for validating every bearer token and applying server-specific policy after token verification.

## zSSH decision

The public OAuth profile now applies a fixed-window request limit **after successful OAuth verification** and keys the bucket with zSSH's existing opaque profile ID rather than the raw OAuth subject or bearer token.

Default production policy:

- 120 authenticated MCP requests per minute per opaque profile;
- configurable with `ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE` in the bounded range 1–6000;
- an in-memory profile table capped at 10,000 active keys by default, configurable with `ZSSH_PUBLIC_RATE_LIMIT_MAX_PROFILES`;
- when the table is full, unseen profiles fail closed with HTTP 429 until an existing window expires;
- blocked responses expose only generic rate-limit metadata and never credentials or raw identity claims;
- the private owner-operated profile is unchanged.

This is intentionally an application-layer guard. The production reverse proxy or hosting layer may add a stricter network-level limiter later, but it must not weaken this per-authenticated-profile policy.

## Release consequence

Changes to the public runtime, limiter, public gateway installer, and their regression tests are release-critical and therefore retrigger the OpenAI public release gate on both pull requests and canonical-main pushes.
