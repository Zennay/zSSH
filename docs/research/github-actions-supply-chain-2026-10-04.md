# GitHub Actions supply-chain pinning — 2026-10-04

## Primary sources

- GitHub Secure use reference: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub repository Actions settings: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- actions/checkout v7.0.1 release: https://github.com/actions/checkout/releases/tag/v7.0.1
- actions/setup-node v7.0.0 release: https://github.com/actions/setup-node/releases/tag/v7.0.0
- actions/upload-artifact v7.0.1 release: https://github.com/actions/upload-artifact/releases/tag/v7.0.1

GitHub documents full-length commit-SHA pinning as the immutable way to reference an action and exposes a repository policy that can require full-length SHA pins.

## zSSH decision

All active zSSH GitHub Actions workflows must pin external actions to a full 40-character commit SHA. Human-readable release comments such as `# v4` may remain beside the immutable SHA, but mutable major-version tags are not executable refs.

Current reviewed pins:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`

A repository-wide regression test scans every active `.github/workflows/*.yml` / `.yaml` file and rejects external `uses:` references that are not pinned to a full 40-character SHA. Local actions under `./` remain permitted.

This extends the M5 DNS-workflow hardening from PR #169 across governance, release-gate, readiness, Auth0 preflight, ingress, origin-watch and CI workflows without changing their permissions or runtime semantics.


## Release-gate coverage invariant

The OpenAI public release gate treats every active `.github/workflows/**` change as release-critical on both pull requests and canonical-main pushes. This avoids a denylist-style gap where a new or previously omitted workflow (for example CI or provenance) could change release/security behavior without rerunning the release-contract gate. Explicit high-value paths remain listed for readability, while the wildcard is the fail-closed coverage boundary.

Regression coverage in `test/release-workflow-trigger.test.mjs` requires pull-request/push parity and requires the workflow wildcard on both triggers.


## Checkout credential persistence invariant

The reviewed `actions/checkout` behavior persists the authentication token for later Git commands by default and supports `persist-credentials: false` to opt out. zSSH active workflows do not require authenticated Git mutation after checkout, so every active checkout step opts out explicitly.

This narrows the lifetime and surface of the job-scoped GitHub credential independently of workflow-level `permissions:` least privilege. Repository-wide regression coverage in `test/workflow-action-pins.test.mjs` rejects any active `actions/checkout` step that omits `persist-credentials: false`.


## Action runtime support invariant

Canonical provenance on 2026-10-04 exposed GitHub's deprecation warning that the previously pinned checkout/setup-node builds still targeted Node.js 20 internally and were being force-run on Node.js 24 by the hosted runner.

The current reviewed releases above declare `runs.using: node24` in their upstream `action.yml`. zSSH therefore pins those exact release commits, rather than relying on GitHub's compatibility shim. The repository-wide workflow test now fail-closes on any external action ref outside this reviewed Node 24-compatible set.

This action-runtime invariant is separate from zSSH's own configured `node-version: 22.23.3`: the former controls the JavaScript runtime used to execute the GitHub Action implementation itself; the latter controls the Node.js toolchain used by zSSH scripts and tests.
