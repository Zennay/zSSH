# Automatic ingress evidence requires exact current main — 2026-10-04

## Source check

GitHub documents that a `workflow_run` event sets the receiving workflow's `GITHUB_SHA` and `GITHUB_REF` to the default branch, while the triggering run's commit is exposed separately as `github.event.workflow_run.head_sha`.

Primary sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
- https://docs.github.com/en/actions/reference/workflows-and-actions/variables

## zSSH decision

The automatic public-ingress preflight is chained from the production DNS publisher. It already required a successful source run from this repository's `main`, and it checked out the source run's `head_sha`.

That was not sufficient for canonical production evidence: if `main` advanced after DNS publication but before the chained ingress preflight executed, the older source SHA could still produce a fresh ingress artifact.

The chained path now fail-closes before external ingress evidence is collected by validating the triggering DNS run's `head_sha` against:
1. merged-PR provenance;
2. live protected-main status; and
3. GitHub's exact current `main` head.

Because `workflow_run`'s own `GITHUB_SHA` points at the default branch rather than necessarily the triggering run, the guard explicitly scopes `GITHUB_SHA` to `github.event.workflow_run.head_sha` for those verifier subprocesses.

This does not widen provider credentials, public tools, or the target endpoint. It only prevents stale DNS-run revisions from generating canonical M5 ingress evidence after `main` has moved.
