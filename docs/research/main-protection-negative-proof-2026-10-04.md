# Main-protection rejected direct-write proof — 2026-10-04

Issue #100 requires more than reading the branch-protection configuration: zSSH must capture a controlled negative proof that a normal write-capable path cannot advance `main` directly.

## Design

The repository owns a dedicated workflow, `zSSH main protection negative proof`, that is deliberately separate from the policy-application workflow.

The proof now uses the short-lived repository-scoped GitHub Actions token as the canary path. The `negative-proof` job grants that token `contents: write`; the script independently verifies that GitHub reports `push: true` and `admin: false` before attempting the direct ref update. This removes the previous requirement to provision and retain a separate `ZSSH_MAIN_PROTECTION_CANARY_TOKEN` secret.

Before a direct-write canary is attempted it requires all of the following:

- the workflow runs from canonical `main`;
- current `main` still passes merged-PR provenance;
- GitHub's ordinary branch metadata reports `protected: true`;
- the canary identity reports `push: true` and `admin: false`;
- the literal confirmation `PROVE_ZSSH_MAIN_PROTECTION` is present.

For manual dispatch the confirmation remains explicit. For the one-time autonomous bootstrap after this change merges, a path-scoped `push` trigger supplies the same fixed confirmation only when the negative-proof implementation or its evidence document changes on `main`.

The canary token first creates an unreachable commit object with the exact current `main` tree. Creating that object proves the token has a real Git write path without changing any branch. The workflow then attempts to advance `refs/heads/main` to that empty-tree-change commit with `force: false`.

Only a GitHub rejection that is recognizably caused by branch policy (protected branch / pull request / required status / ruleset / repository rule) is accepted as green evidence. A generic authentication or permission failure is inconclusive and fails closed.

If GitHub unexpectedly accepts the ref update, the workflow fails with a CRITICAL result and does not issue a green receipt. The automatic trigger is path-scoped and the canary commit changes no tree content, so an unexpected accepted canary does not recursively retrigger this workflow. Existing canonical provenance and production-release gates also prevent such a direct commit from being treated as releasable state.

## Deep verification and combined evidence

A repository-admin token is now optional for this negative-proof script. When `ZSSH_REPO_ADMIN_TOKEN` is present, the script also deep-verifies the canonical protection policy and records `deep_protection_verified: true`. When it is absent, the script records `deep_protection_verified: false` and still requires both the public protected flag and a policy-attributable rejection from a real non-admin write path.

This is intentional because the canonical VPS apply lane already performs the privileged deep verification separately. On 2026-10-04, zCloud run `37180567223` completed successfully and public branch metadata changed to `protected: true`. The remaining issue #100 acceptance evidence is therefore the non-admin direct-write rejection receipt produced by this workflow.

## Protected environment inputs

The `repository-governance` environment may contain:

- `ZSSH_REPO_ADMIN_TOKEN`: optional short-lived repository Administration token for same-run deep protection verification.

No separate canary secret is required. The GitHub Actions `github.token` is ephemeral and is not serialized. The artifact contains only commit SHAs, booleans, the rejection HTTP status, and a bounded policy rejection message.

A green rejection receipt plus the already-green privileged apply/deep-verification evidence closes the technical acceptance criteria for issue #100. It still does not automatically set `ZSSH_MAIN_PROTECTION_VERIFIED=1`; that release attestation should only be set after the two receipts are reviewed together.
