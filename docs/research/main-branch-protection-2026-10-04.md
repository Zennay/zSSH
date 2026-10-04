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

The repository rulesets collection currently returns an empty list. The connected GitHub integration cannot read the detailed classic branch-protection endpoint because it lacks repository-administration access.

GitHub's ordinary **Get a branch** endpoint is readable with repository metadata access and reports whether a branch is protected by classic branch protection or rulesets. On 2026-10-04, `GET /repos/Zennay/zSSH/branches/main` returned `protected: false`, `protection.enabled: false`, and no required status checks at canonical main `f247ae66...`. This is conclusive evidence that preventive protection is currently absent, without needing the administration-only detailed protection endpoint.

## Engineering decision

1. Keep merged-PR provenance verification as defense in depth.
2. Add `ZSSH_MAIN_PROTECTION_VERIFIED=1` to the protected `openai-production` release contract.
3. Do not set that value until preventive policy on `main`:
   - requires PR-based changes;
   - requires the zSSH CI/repository-hygiene check;
   - does not leave a normal direct-push bypass path; and
   - has been proven by a controlled negative test where a direct write to `main` is rejected.
4. Classify repository governance separately from DNS, Auth0, reviewer-fixture, and OpenAI portal/host gates in the M5 readiness receipt.
5. Add a secret-safe live branch-status probe using `GET /repos/{owner}/{repo}/branches/main`; readiness must classify repository governance as not ready unless GitHub reports `protected: true`.
6. The final production workflow must run that live probe with `--require-protected` **before** entering `openai-production`; the manual `ZSSH_MAIN_PROTECTION_VERIFIED=1` remains necessary for the stronger requirements that the metadata endpoint cannot prove (required PR flow/checks, bypass policy, and the controlled rejected-direct-push test).
7. Record only non-secret booleans/status-check names in automated evidence; do not serialize credentials or administrative tokens.

This deliberately makes final production submission fail closed until issue #100 is closed with preventive evidence rather than relying only on after-the-fact provenance quarantine.
