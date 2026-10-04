# Preventive main protection automation — 2026-10-04

## Problem

Issue #100 exists because zSSH's provenance and repository-hygiene checks detect an unsafe direct write only after it lands. M5 needs prevention before the release repository can be attested as protected.

## Current primary sources

- GitHub protected-branch REST API: https://docs.github.com/en/rest/branches/branch-protection
- GitHub protected-branch behavior: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub required-check troubleshooting: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

GitHub documents that changing branch protection requires repository Administration (write), and that required status checks plus pull-request requirements can block direct branch updates. A zero approving-review count is supported, which lets a solo maintainer require the PR path without creating an impossible self-review requirement.

## zSSH decision

Add a manual, fail-closed repository-governance lane instead of weakening the release gate or storing repository-admin credentials in normal CI.

The canonical policy for `main` is:

- require strict status checks;
- require the current zSSH CI job `test`;
- bind that check to the GitHub Actions app id observed on canonical main (`15368`);
- require pull-request based changes with zero mandatory approving reviewers;
- enforce protection for administrators;
- require conversation resolution;
- disable force pushes and branch deletion.

The workflow is split into two jobs. The first runs without repository-admin credentials and proves the dispatched ref is canonical `main` with merged-PR provenance. Only then may the protected `repository-governance` environment expose `ZSSH_REPO_ADMIN_TOKEN` to the mutation job.

## Evidence and limitation

The helper performs the branch-protection PUT and then re-reads the API response, failing closed unless the effective settings match the canonical policy. It emits only non-secret booleans and identifiers.

This does not fabricate the final negative direct-push proof required by issue #100. After the policy is applied, a normal non-bypass write path still needs to demonstrate that GitHub rejects a direct update to `main`. Until that evidence exists, `ZSSH_MAIN_PROTECTION_VERIFIED=1` must remain unset.
