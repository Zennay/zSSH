# Auth0 production evidence provenance — 2026-10-04

## M5 invariant

The protected `Auth0 production readiness` workflow reads production Auth0 configuration and a Management API token, so both activation paths must be bound to canonical protected `main`.

The reviewed push-marker path already requires:

- the exact `.github/openai-production-auth0-trigger` marker value;
- merged-PR provenance;
- live branch protection.

Manual `workflow_dispatch` now additionally requires:

- `GITHUB_REF == refs/heads/main`;
- merged-PR provenance for the executing revision;
- live branch protection;
- `GITHUB_SHA` equal to GitHub's exact current `main` SHA.

This prevents a stale or feature-branch workflow revision from consuming protected Auth0 credentials and producing production-readiness evidence.

## Regression guard

`test/release-workflow-trigger.test.mjs` locks the manual Auth0 path to exact current protected main while preserving the reviewed push-marker activation.
