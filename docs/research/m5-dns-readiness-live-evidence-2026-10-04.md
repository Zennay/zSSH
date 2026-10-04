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

- **No live DNS + no Cloudflare token:** external-input gate; provision the scoped token. The hourly protected readiness audit detects environment-only credential changes without requiring a repository push.
- **No live DNS + token present:** internal-action gate; dispatch **zSSH production DNS publish** from exact canonical `main` and enter `PUBLISH_ZSSH_PRODUCTION_DNS`. This is the shortest guarded path because the workflow itself re-verifies merged-PR provenance, branch protection, exact-current main, provider validity, dry-run/apply binding, and external convergence.
- **Reviewed push activation:** the `.github/openai-production-dns-trigger` marker remains available when a code-reviewed push activation is specifically preferred, but it is not required for the normal post-credential handoff.
- **Live DNS observed:** DNS publication remains green even if the one-time provider credential is later removed.
- **Invalid optional zone override:** fail closed until the override is repaired or removed.

This keeps credential presence separate from deployment evidence and prevents the managed M5 blocker from skipping the actual provider execution step.

## Security impact

No credential values are added to artifacts, issue bodies, or workflow outputs. Only the existing public-origin stage enum crosses job boundaries. The production publisher remains separately guarded by exact-current protected-main provenance and the protected `openai-production` environment. Manual dispatch also requires the immutable confirmation phrase, so preferring it in the readiness handoff removes an unnecessary code-change cycle without weakening the mutation boundary.
