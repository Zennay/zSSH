# Redundant pull-request sweep — 2026-10-04

Status: implemented as M5 release-governance hardening.

## Incident

During concurrent M5 work, PR #271 landed the npm toolchain provenance change and a separately rebuilt PR #272 with the same effective tree was still merged shortly afterward. Comparing canonical commit `9bb66b5...` with the resulting `b33a540...` showed no changed files. The extra commit did not alter runtime code, but it consumed protected-main history, CI and release-evidence churn.

## Primary sources

- GitHub protected branches and strict required status checks:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub status checks:
  https://docs.github.com/en/pull-requests/reference/status-checks
- GitHub workflow-level `GITHUB_TOKEN` permissions:
  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
- GitHub REST pull-request endpoints:
  https://docs.github.com/en/rest/pulls/pulls

## Decision

Keep the existing strict protected-main policy and add a second, narrow guard for the portfolio's high-concurrency worker pattern:

1. after every canonical `main` push, inspect open PRs targeting `main`;
2. consider only PRs whose head repository is exactly `Zennay/zSSH`;
3. ask GitHub for the PR's current effective file diff;
4. if the diff has zero files, re-read the PR head and check the zero-file diff a second time;
5. close it only when the head SHA is unchanged and it is still open.

The workflow executes trusted code from canonical `main`. It never checks out a PR head, receives `contents: read` plus only `pull-requests: write`, and uses no persistent credential. Fork PRs are intentionally excluded.

## Failure posture

API errors, an unexpected repository/base, missing token, a 100-item open-PR page, changed head SHA, or a non-array GitHub response all fail or skip closed-state mutation rather than guessing.

This guard does not replace branch protection, required checks, or the canonical-main provenance gate. It only removes a concurrency race that can otherwise produce semantically empty duplicate merges.
