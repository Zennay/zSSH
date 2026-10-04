# Shared non-public hostname IP-literal invariant — 2026-10-04

## Finding

PR #215 correctly made the central HTTPS release validator reject all IPv4 and IPv6 literals when a public DNS hostname is required. The exported `isNonPublicHostname()` helper itself still returned false for globally routable IP literals.

Several M5 paths call that helper directly instead of going through the central URL validator, including:

- final production submission probe demo-recording URL checks;
- OpenAI Verify Domain evidence binding;
- Auth0 production URL validation.

That meant those direct callers could diverge from the stronger DNS-hostname policy.

## Decision

Make `isNonPublicHostname()` itself classify every IPv4 or IPv6 literal as non-public. Keep test-only development paths available through existing callers that explicitly disable public-host requirements.

The central HTTPS validator now delegates IP-literal classification to the shared helper instead of duplicating `isIP()` logic.

## Evidence

Regression tests cover public IPv4 and IPv6 literals in the shared helper and in Verify Domain binding. Existing release/probe tests cover the downstream production paths.

This does not perform network access or alter OAuth scopes, public tools, credentials, target permissions, or provider state.


## Single-label hostname follow-up

The shared helper now also classifies single-label names such as `intranet` as non-public. This keeps direct helper consumers, the central release/probe URL validator, protected readiness and the submission builder on the same DNS-hostname boundary.

Regression coverage verifies single-label rejection in the shared helper, public MCP URL validation and Verify Domain evidence binding. Existing development opt-outs remain unchanged.
