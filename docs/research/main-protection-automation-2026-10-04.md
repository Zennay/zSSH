# Preventive main protection automation — 2026-10-04

## Problem

Issue #100 exists because zSSH's provenance and repository-hygiene checks detect an unsafe direct write only after it lands. M5 needs preventive repository-level enforcement before the release repository can be attested as protected.

## Current primary sources

- GitHub branch protection REST API: https://docs.github.com/en/rest/branches/branch-protection
- GitHub protected branch behavior: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub required status checks: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

GitHub requires repository Administration write access to change branch protection. The normal Actions token and the connected GitHub App intentionally do not receive that authority.

## zSSH decision

Add a manual, fail-closed `repository-governance` workflow instead of weakening the release gate or exposing repository-admin credentials to ordinary CI.

The canonical policy for `main` is:

- require strict status checks;
- require the zSSH CI job `test`, bound to the GitHub Actions app id;
- require pull-request based changes with zero mandatory approving reviews for the solo-maintainer flow;
- enforce protection for administrators;
- require conversation resolution;
- disable force pushes and branch deletion.

The workflow first proves it is running on canonical `main` with accepted merged-PR provenance. Only then may the protected `repository-governance` environment expose `ZSSH_REPO_ADMIN_TOKEN` to the mutation job. The applier performs the PUT and then re-reads branch protection, producing a secret-free receipt.

## Remaining live acceptance proof

This automation does not claim issue #100 is closed by itself. Once the protected environment contains a repository-admin token, dispatch `zSSH main protection` from `main` with confirmation `PROTECT_ZSSH_MAIN`. Then capture:

1. the green workflow receipt;
2. `npm run repo:main-protection:verify` with repo-admin read access;
3. a controlled rejected direct-write proof.

Only after all three are green should `ZSSH_MAIN_PROTECTION_VERIFIED=1` be set in `openai-production`.
