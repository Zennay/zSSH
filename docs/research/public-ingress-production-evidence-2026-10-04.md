# Public ingress production evidence hardening — 2026-10-04

## M5 invariant

The GitHub-hosted public ingress preflight produces production evidence, so its workflow target is repository-locked to `https://zssh.cheapgpt.shop/mcp`.

Manual dispatch accepts no URL override. It must run from `refs/heads/main`, pass merged-PR provenance, require live branch protection, and prove that `GITHUB_SHA` is the exact current GitHub-reported `main` revision before network evidence is collected.

The automatic `workflow_run` path remains chained only from a successful canonical `zSSH production DNS publish` run, verifies the source branch and repository before checkout, and proves that the source run's `head_sha` is still the exact current protected `main` revision before network evidence is collected. This prevents rerunning an older successful DNS publication from minting fresh production ingress evidence after `main` has advanced.

The reusable `scripts/check-public-ingress.mjs` checker remains generic for tests and non-production use; only the production evidence workflow is target-locked.

## Regression guard

`test/public-ingress-preflight.test.mjs` requires the canonical URL, rejects `inputs.mcp_url`, and locks manual evidence to exact current protected main.

## GitHub Actions source-freshness rationale — 2026-10-04

GitHub documents that a `workflow_run`-triggered workflow receives `GITHUB_SHA` / `GITHUB_REF` for the default branch, not the upstream workflow's source revision. The upstream revision therefore has to be bound explicitly through `github.event.workflow_run.head_sha` when production evidence must correspond to the exact producer commit.

Primary sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
- https://docs.github.com/en/actions/reference/security/secure-use

The source SHA is passed as an intermediate environment variable and compared against live GitHub branch metadata by the existing branch-protection verifier. No provider credential, public tool surface, OAuth scope, or DNS destination changes.


## Direct-origin DNS binding — 2026-10-04

The production preflight is now also bound to the reviewed direct VPS address `198.244.191.182`. Public routability alone is not sufficient production evidence: a DNS drift to another globally routable address could otherwise pass the DNS guard and continue into HTTPS/MCP checks.

The reusable checker accepts an optional expected-address set. When that set is present, the externally resolved address set must match it exactly before any HTTP request is made. The production workflow supplies only `198.244.191.182`, so an unexpected A or AAAA answer fails closed. Generic development/test use remains unchanged when no expected-address set is supplied.

This does not publish DNS or change the selected origin. It makes the post-publication evidence prove that the reviewed hostname still resolves to the reviewed direct VPS before accepting TLS, health, MCP-auth or OAuth-metadata evidence.
