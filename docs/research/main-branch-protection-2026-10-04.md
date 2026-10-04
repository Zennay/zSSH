# Main-branch protection release gate — 2026-10-04

Status: implemented as an M5 production-readiness/release prerequisite.

## Incident context

A direct commit reached canonical `main` during portfolio runner recovery and introduced cross-project workflow content into the zSSH release repository. PR #97 removed that content and the provenance checker now rejects untrusted first-parent history, but post-write detection alone does not prevent the next direct write.

GitHub issue #100 tracks preventive repository enforcement.

## Primary sources re-checked on 2026-10-04

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/rest/branches/branches
- https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28

Current GitHub behavior relevant to zSSH:
- branch protection can require pull requests and required status checks before changes reach a protected branch;
- repository branch rulesets can also require a pull request and required status checks;
- bypass configuration matters: a rule that ordinary automation or users can bypass does not close the direct-write incident path;
- rulesets are viewable with read access, while editing repository rules requires administrative permission.

## Live repository observation

The repository rulesets collection currently returns an empty list. The connected GitHub integration cannot read the detailed classic branch-protection endpoint because that endpoint requires repository-administration read permission.

GitHub's ordinary `GET /repos/{owner}/{repo}/branches/{branch}` response also exposes a `protected` boolean indicating whether branch protection or a ruleset applies. On 2026-10-04, the live `main` response for zSSH returned `protected: false`, `protection.enabled: false`, and no required status checks at canonical commit `31817ee893f7a2df0f30fe583f08a49b91c572bb`. That removes the earlier ambiguity: preventive protection is currently absent.

## Engineering decision

1. Keep merged-PR provenance verification as defense in depth.
2. Add `ZSSH_MAIN_PROTECTION_VERIFIED=1` to the protected `openai-production` release contract.
3. Do not set that value until preventive policy on `main`:
   - requires PR-based changes;
   - requires the zSSH CI/repository-hygiene check;
   - does not leave a normal direct-push bypass path; and
   - has been proven by a controlled negative test where a direct write to `main` is rejected.
4. Classify repository governance separately from DNS, Auth0, reviewer-fixture, and OpenAI portal/host gates in the M5 readiness receipt.
5. Record only the boolean attestation in release evidence; do not serialize credentials or administrative tokens.

This deliberately makes final production submission fail closed until issue #100 is closed with preventive evidence rather than relying only on after-the-fact provenance quarantine.


## Repository-owned verification command

The repository now contains a fail-closed verifier for the administrative setting tracked in issue #100:

```bash
GITHUB_REPOSITORY=Zennay/zSSH \
GITHUB_TOKEN="<admin token with branch-protection read access>" \
npm run repo:main-protection:verify
```

The verifier reads the live `main` protection state and only returns green when all of these repository-policy conditions are true:

- pull-request based changes are required;
- the zSSH CI job context `test` is required;
- protection applies to administrators;
- no explicit pull-request bypass users, teams, or apps are configured.

The command does not serialize the token into evidence. A 404, inaccessible protection endpoint, missing required rule, missing required check, disabled admin enforcement, or configured bypass actor fails closed.

This verifier intentionally does **not** replace the acceptance criterion for a controlled rejected-direct-push test. After the setting is applied, capture both the green verifier output and the rejected write proof before setting `ZSSH_MAIN_PROTECTION_VERIFIED=1`.


## Metadata-only release binding

The deep `repo:main-protection:verify` command remains the authoritative check for PR requirements, required `test` status, administrator enforcement, and explicit bypass actors; it needs branch-protection read permission.

For ordinary GitHub Actions, `repo:main-protection:status` now uses the non-admin branch metadata endpoint. This mode does not pretend to prove the detailed policy. It proves only the necessary prerequisite that GitHub currently reports `main` as protected.

The protected M5 readiness workflow feeds that live boolean into the repository-governance lane. The final production workflow executes the same metadata check with `--require-protected` before entering the `openai-production` environment. Therefore a stale manual `ZSSH_MAIN_PROTECTION_VERIFIED=1` cannot make a release candidate pass while GitHub currently reports `main` unprotected.


## Repository-owned application lane

The repository now also has a guarded mutation path for applying the canonical policy instead of leaving issue #100 as a UI-only operation.

The manual `zSSH main protection` workflow first proves canonical `main` merged-PR provenance, then enters the separate protected `repository-governance` environment. Only that protected job can read `ZSSH_REPO_ADMIN_TOKEN`, and mutation additionally requires the literal confirmation `PROTECT_ZSSH_MAIN`.

The applied policy requires strict status checks, binds the `test` check to GitHub Actions app id `15368`, requires PR-based changes with zero approving reviewers for the solo-maintainer flow, includes administrators, requires conversation resolution, and disables force pushes and branch deletion. After the PUT, the helper re-reads effective protection and reuses the existing deep verifier semantics so a partial or unexpected policy fails closed.

GitHub's branch-protection REST endpoint requires repository Administration (write) to update policy. The routine ChatGPT GitHub integration does not have that permission, so the mutation credential is deliberately isolated from normal CI rather than broadening routine automation credentials.

The workflow does **not** set `ZSSH_MAIN_PROTECTION_VERIFIED=1`. Issue #100 remains open until a controlled normal direct-write attempt is rejected and that negative evidence is captured.

## Autonomous merged-PR application trigger

The guarded application lane is no longer manual-only. It now also listens for a closed pull request targeting `main`, but the provenance job runs only when that pull request was actually merged. For merged events it binds `GITHUB_SHA` to `pull_request.merge_commit_sha` before running the canonical provenance verifier.

Only after that proof succeeds can the workflow enter the protected `repository-governance` environment and read `ZSSH_REPO_ADMIN_TOKEN`. The existing explicit confirmation remains required for manual dispatch; the merged-PR path supplies the fixed repository-owned confirmation value because the event itself is already constrained by merged status, exact SHA binding and provenance.

This makes repository protection self-healing once the protected admin credential exists: a canonical merged change can apply/re-apply the expected policy without a separate UI dispatch. If the environment or credential is absent, the mutation job fails closed and no weaker fallback is used. The workflow still has no `contents: write`, does not use `git push`, and does not mark `ZSSH_MAIN_PROTECTION_VERIFIED=1` without the separate rejected-direct-write evidence required by issue #100.

## Canonical merged-event activation proof

PR #120 made the guarded main-protection workflow's merged-PR trigger canonical. Because a workflow cannot be assumed to trigger itself from an event definition that only becomes part of the default branch during that same merge, the next canonical merged PR is used as the first deterministic activation event.

This documentation-only evidence change is intentionally small: its merge should run the normal zSSH CI/release gates and then exercise the already-canonical `pull_request: closed` governance path. Success is measured independently through GitHub's live `main.protected` metadata and, where available, the resulting workflow run. If the protected repository-admin credential is absent, the lane must fail closed and `main` must remain unprotected.

