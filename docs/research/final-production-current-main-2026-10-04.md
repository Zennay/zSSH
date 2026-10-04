# Final production submission canonical-main binding — 2026-10-04

## M5 invariant

The `OpenAI public release gate` manual production submission path enters the protected `openai-production` environment and consumes the full release credential/attestation set. It must therefore execute only for the exact current canonical release revision.

Before the production job can start, the provenance job now requires:

- `GITHUB_REF == refs/heads/main`;
- merged-PR provenance for the executing SHA;
- GitHub live branch protection;
- `GITHUB_SHA` equal to GitHub's exact current `main` SHA;
- immutable rejected-direct-write governance evidence.

This prevents a stale historical merge commit or feature-branch ref from consuming production release secrets or creating submission evidence after `main` has advanced.

## Regression guard

`test/production-readiness-audit.test.mjs` locks both the canonical-main ref requirement and the exact-current protected-main SHA check for the final production lane.
