# M5 DNS readiness uses live public-origin evidence — 2026-10-04

## Problem

The protected M5 readiness audit previously treated the `dns_publication` lane as ready when the Cloudflare credential was merely configured. That is configuration readiness, not execution evidence: the guarded DNS publisher may still need to run, and public DNS may still be unresolved.

That creates an unsafe handoff for autonomous consumers because the active blocker can advance to Auth0 before the DNS publication step has actually converged.

## Decision

The protected readiness workflow now carries the non-secret `stage` from the existing public-origin observation job into the readiness classifier as `ZSSH_PUBLIC_ORIGIN_STAGE`.

The DNS lane is complete only after live public-origin observation has advanced beyond the DNS lookup stage. Accepted post-DNS stages are:

- `https_health`
- `mcp_auth`
- `oauth_metadata`
- `transport`
- `ready`

Unknown, URL-contract, missing, or explicit `dns` stages fail closed.

## Handoff semantics

- **No live DNS + no Cloudflare token:** external-input gate; provision the scoped token.
- **No live DNS + token present:** internal-action gate; run the guarded production DNS publisher.
- **Live DNS observed:** DNS publication remains green even if the one-time provider credential is later removed.
- **Invalid optional zone override:** fail closed until the override is repaired or removed.

This keeps credential presence separate from deployment evidence and prevents the managed M5 blocker from skipping the actual provider execution step.

## Security impact

No credential values are added to artifacts, issue bodies, or workflow outputs. Only the existing public-origin stage enum crosses job boundaries. The production publisher remains separately guarded by exact-current protected-main provenance and the protected `openai-production` environment.
