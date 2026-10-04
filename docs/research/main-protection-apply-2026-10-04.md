# Preventive main-protection apply lane — 2026-10-04

Status: implementation for M5 repository-governance issue #100.

## Why this lane exists

Canonical zSSH now has two read-side protections:

- the deep admin-readable verifier checks PR enforcement, the required `test` status context, administrator enforcement, and explicit bypass actors;
- the metadata-only release binding fails before protected production secrets when GitHub reports `main` as unprotected.

Neither read-side check can change GitHub repository settings. Issue #100 therefore still needs a guarded write lane.

## Decision

The repository owns a manual `zSSH main protection apply` workflow. It may mutate only the canonical `Zennay/zSSH` `main` protection endpoint and only after:

1. the dispatch ref is exactly `main`;
2. the dispatched commit has merged-PR provenance back to the trusted recovery boundary;
3. the job enters the separate `repository-governance` environment;
4. a repository Administration token is supplied there as `ZSSH_REPO_ADMIN_TOKEN`;
5. the operator confirmation is exactly `PROTECT_ZSSH_MAIN`.

The normal workflow token remains read-only. The admin token is not printed or included in receipts.

## Canonical policy

The applied policy:

- requires strict status checks;
- requires the zSSH CI job context `test`, bound to GitHub Actions app id `15368`;
- requires pull-request based changes while keeping mandatory approvals at 0 for the solo-maintainer flow;
- enforces protection for administrators;
- allows no explicit pull-request bypass actors;
- requires review-conversation resolution;
- disables force pushes and branch deletion.

After the PUT, the helper re-reads the detailed protection API and validates the effective policy. The workflow then independently runs the existing deep verifier and the ordinary branch-metadata `--require-protected` check.

## What this deliberately does not do

A successful policy write is not the final issue #100 proof. The workflow does **not** set `ZSSH_MAIN_PROTECTION_VERIFIED=1`.

After protection is live, a controlled normal direct-write attempt must still be rejected. Only after that negative proof is captured should the production attestation be set and issue #100 be closed.
