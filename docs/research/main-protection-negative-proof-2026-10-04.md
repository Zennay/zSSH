# Main-protection rejected direct-write proof — 2026-10-04

Issue #100 requires more than reading the branch-protection configuration: zSSH must capture a controlled negative proof that a normal write-capable path cannot advance `main` directly.

## Design

The repository now owns a manual workflow, `zSSH main protection negative proof`, that is deliberately separate from the policy-application workflow.

Before a direct-write canary is attempted it requires all of the following:

- the workflow was dispatched from canonical `main`;
- current `main` still passes merged-PR provenance;
- GitHub's ordinary branch metadata reports `protected: true`;
- a repository-admin token confirms the full canonical protection policy;
- a separate canary token reports `push: true` and `admin: false`;
- the literal confirmation `PROVE_ZSSH_MAIN_PROTECTION` is supplied.

The canary token first creates an unreachable commit object with the exact current `main` tree. Creating that object proves the token has a real Git write path without changing any branch. The workflow then attempts to advance `refs/heads/main` to that empty-tree-change commit with `force: false`.

Only a GitHub rejection that is recognizably caused by branch policy (protected branch / pull request / required status / ruleset / repository rule) is accepted as green evidence. A generic authentication or permission failure is inconclusive and fails closed.

If GitHub unexpectedly accepts the ref update, the workflow fails with a CRITICAL result and does not issue a green receipt. The existing canonical provenance and production-release gates then prevent that unexpected direct commit from being treated as a releasable state.

## Protected environment inputs

The `repository-governance` environment must contain:

- `ZSSH_REPO_ADMIN_TOKEN`: short-lived repository Administration token used only for deep protection verification;
- `ZSSH_MAIN_PROTECTION_CANARY_TOKEN`: separate non-admin token with ordinary repository contents write permission.

Neither token is serialized. The artifact contains only commit SHAs, booleans, the rejection HTTP status, and a bounded policy rejection message.

A green receipt from this workflow is the missing negative-test evidence for issue #100. It still does not automatically set `ZSSH_MAIN_PROTECTION_VERIFIED=1`; that release attestation should only be set after reviewing the green apply/verifier/proof evidence together.
