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

Current GitHub behavior relevant to zSSH:
- branch protection can require pull requests and required status checks before changes reach a protected branch;
- repository branch rulesets can also require a pull request and required status checks;
- bypass configuration matters: a rule that ordinary automation or users can bypass does not close the direct-write incident path;
- rulesets are viewable with read access, while editing repository rules requires administrative permission.

## Live repository observation

The repository rulesets collection currently returns an empty list. The connected GitHub integration cannot read the classic branch-protection endpoint because it lacks repository-administration access, so an empty ruleset collection must **not** be interpreted as proof that classic branch protection is absent or present.

The release gate therefore does not fabricate automatic proof from incomplete API visibility.

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
