# GitHub Actions supply-chain pinning — 2026-10-04

## Primary sources

- GitHub Secure use reference: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub repository Actions settings: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository

GitHub documents full-length commit-SHA pinning as the immutable way to reference an action and exposes a repository policy that can require full-length SHA pins.

## zSSH decision

All active zSSH GitHub Actions workflows must pin external actions to a full 40-character commit SHA. Human-readable release comments such as `# v4` may remain beside the immutable SHA, but mutable major-version tags are not executable refs.

Current reviewed pins:

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4`
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4`

A repository-wide regression test scans every active `.github/workflows/*.yml` / `.yaml` file and rejects external `uses:` references that are not pinned to a full 40-character SHA. Local actions under `./` remain permitted.

This extends the M5 DNS-workflow hardening from PR #169 across governance, release-gate, readiness, Auth0 preflight, ingress, origin-watch and CI workflows without changing their permissions or runtime semantics.


## Release-gate coverage invariant

The OpenAI public release gate treats every active `.github/workflows/**` change as release-critical on both pull requests and canonical-main pushes. This avoids a denylist-style gap where a new or previously omitted workflow (for example CI or provenance) could change release/security behavior without rerunning the release-contract gate. Explicit high-value paths remain listed for readability, while the wildcard is the fail-closed coverage boundary.

Regression coverage in `test/release-workflow-trigger.test.mjs` requires pull-request/push parity and requires the workflow wildcard on both triggers.

## Checkout credential persistence invariant

GitHub's `actions/checkout` action persists the workflow authentication token into the local Git configuration unless `persist-credentials: false` is set. zSSH does not need that persisted Git credential in its active workflows: repository mutations use explicitly scoped API credentials or GitHub's job token at the exact consuming step.

All active `.github/workflows/*.yml` / `.yaml` checkout steps therefore set `persist-credentials: false`. The existing repository-wide workflow regression test also scans every active checkout step and rejects any future workflow that omits this setting.

This reduces ambient credential lifetime inside CI, governance, readiness and production-release jobs without changing branch-protection, provider, or release permissions.
