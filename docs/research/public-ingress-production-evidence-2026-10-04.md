# Public ingress production evidence hardening — 2026-10-04

## M5 invariant

The GitHub-hosted public ingress preflight produces production evidence, so its workflow target is repository-locked to `https://zssh.cheapgpt.shop/mcp`.

Manual dispatch accepts no URL override. It must run from `refs/heads/main`, pass merged-PR provenance, require live branch protection, and prove that `GITHUB_SHA` is the exact current GitHub-reported `main` revision before network evidence is collected.

The production evidence workflow is intentionally **not** chained directly from `zSSH production DNS publish`. DNS convergence only makes the next repository-owned gate executable; it does not prove that the isolated public gateway and Caddy ingress have been promoted on the VPS. The canonical sequence is DNS convergence → bounded VPS public-gateway/Caddy rollout → explicit external ingress preflight. Keeping the preflight on guarded manual dispatch prevents an expected false-negative run in the gap between DNS publication and ingress rollout.

The reusable `scripts/check-public-ingress.mjs` checker remains generic for tests and non-production use; only the production evidence workflow is target-locked.

## Regression guard

`test/public-ingress-preflight.test.mjs` requires the canonical URL, rejects `inputs.mcp_url`, requires guarded manual dispatch, rejects a direct `workflow_run` dependency on DNS publication, and locks evidence to exact current protected main.

## Post-DNS sequencing rationale — 2026-10-04

The live M5 handoff classifies `public_ingress` as an internal action only **after** public DNS has converged. On the current production topology the public gateway/Caddy rollout is a separate VPS mutation and may not exist when the DNS workflow finishes. A DNS-completion `workflow_run` trigger therefore races ahead of the required rollout and can create a red ingress run that represents sequencing, not a release defect.

The external preflight is now dispatched only after the bounded VPS rollout has completed. Its existing merged-PR provenance, protected-branch and exact-current-`main` checks still bind the resulting evidence to canonical code. The final protected release also reruns the same external checker, so removing the premature DNS trigger does not weaken the final release gate.

No provider credential, public tool surface, OAuth scope, DNS destination or VPS permission changes.


## Direct-origin DNS binding — 2026-10-04

The production preflight is now also bound to the reviewed direct VPS address `198.244.191.182`. Public routability alone is not sufficient production evidence: a DNS drift to another globally routable address could otherwise pass the DNS guard and continue into HTTPS/MCP checks.

The reusable checker accepts an optional expected-address set. When that set is present, the externally resolved address set must match it exactly before any HTTP request is made. The production workflow supplies only `198.244.191.182`, so an unexpected A or AAAA answer fails closed. Generic development/test use remains unchanged when no expected-address set is supplied.

This does not publish DNS or change the selected origin. It makes the post-publication evidence prove that the reviewed hostname still resolves to the reviewed direct VPS before accepting TLS, health, MCP-auth or OAuth-metadata evidence.
