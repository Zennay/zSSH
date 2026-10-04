# Shared public-hostname single-label and trailing-dot invariant — 2026-10-04

## Finding

The shared `isNonPublicHostname()` helper now rejects IP literals, but direct callers could still treat a single-label hostname such as `reviewer` as public. Reserved/local names with a DNS trailing dot, such as `localhost.` or `example.com.`, also bypassed exact suffix comparisons.

Protected readiness had separate `hostname.includes(".")` checks in some paths, while final production-probe and Verify Domain callers rely directly on the shared helper. That left another cross-gate parity gap.

## Decision

The shared helper now:

- trims and lowercases hostnames;
- removes IPv6 URL brackets and one terminal DNS root dot for classification;
- rejects all IP literals;
- rejects every remaining single-label hostname;
- applies local/reserved suffix checks to the normalized hostname.

A legitimate dotted DNS name remains public under this shape check, including its equivalent absolute DNS spelling with a terminal dot. Network reachability and TLS evidence remain separate live gates.

## Safety

This is validation-only hardening. It does not perform network access, mutate DNS, change credentials, widen OAuth scopes or public tools, or change target permissions.
