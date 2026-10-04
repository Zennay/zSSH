# Public ingress production evidence hardening — 2026-10-04

## M5 invariant

The GitHub-hosted public ingress preflight produces production evidence, so its workflow target is repository-locked to `https://zssh.cheapgpt.shop/mcp`.

Manual dispatch accepts no URL override. It must run from `refs/heads/main`, pass merged-PR provenance, require live branch protection, and prove that `GITHUB_SHA` is the exact current GitHub-reported `main` revision before network evidence is collected.

The automatic `workflow_run` path remains chained only from a successful canonical `zSSH production DNS publish` run and verifies the source branch and repository.

The reusable `scripts/check-public-ingress.mjs` checker remains generic for tests and non-production use; only the production evidence workflow is target-locked.

## Regression guard

`test/public-ingress-preflight.test.mjs` requires the canonical URL, rejects `inputs.mcp_url`, and locks manual evidence to exact current protected main.
