# GitHub Actions manual-input shell safety — 2026-10-04

## Context

The protected M5 production DNS workflow accepts a manual `workflow_dispatch` confirmation string before a Cloudflare DNS mutation. The current workflow interpolates `${{ inputs.confirmation }}` directly into an inline Bash script.

Although the confirmation input is operator-supplied, the production lane has access to a protected environment and a scoped Cloudflare credential. Treating all context/input values as data rather than shell source is the safer invariant for this privileged mutation path.

## Primary source

GitHub, **Secure use reference — Good practices for mitigating script injection attacks** (accessed 2026-10-04):

https://docs.github.com/en/actions/reference/security/secure-use#good-practices-for-mitigating-script-injection-attacks

GitHub documents that expressions are substituted into generated shell scripts before execution and recommends using an intermediate environment variable for inline scripts so the value does not participate in script generation.

## Decision

For the manual zSSH DNS confirmation step:

- pass `inputs.confirmation` through a step-scoped environment variable;
- compare the quoted environment variable in Bash;
- do not interpolate the input expression directly inside `run:`;
- keep the exact confirmation phrase and all existing protected-main/provenance gates unchanged;
- add a regression test that rejects a return to direct expression interpolation in the confirmation shell.

This change is intentionally narrow. It does not alter who may dispatch the workflow, the protected `openai-production` environment, the Cloudflare credential scope, or the DNS destination.

## Security invariant

No user- or operator-controlled GitHub Actions context value should be inserted directly into shell source in a privileged production mutation step when it can instead be passed as data through `env:`.

## Acceptance evidence

- workflow regression test proves the confirmation value is carried through a step-scoped environment variable;
- workflow regression test proves the inline shell no longer contains `${{ inputs.confirmation }}`;
- existing exact-main, provenance, branch-protection, immutable-action-pin and Cloudflare-token-scope tests remain green.


## workflow_run event-data extension — 2026-10-04

GitHub's current script-injection guidance also calls out the `github` context as potentially untrusted and specifically notes that branch names can contain shell-significant characters. The public ingress preflight previously interpolated `github.event.workflow_run.head_branch`, `head_repository.full_name`, and `conclusion` directly into an inline Bash script.

Primary sources re-checked on 2026-10-04:
- https://docs.github.com/en/actions/concepts/security/script-injections
- https://docs.github.com/en/actions/reference/security/secure-use#good-practices-for-mitigating-script-injection-attacks
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts

Decision:
- keep the existing `workflow_run` source-binding checks unchanged;
- pass the source conclusion, branch, repository identity, and expected repository through step-scoped environment variables;
- compare only quoted shell variables inside `run:`;
- add regression coverage that rejects any `${{ github.* }}` expression inside that source-validation shell body.

This does not relax source verification or broaden workflow permissions. It only removes event-controlled text from generated shell source before the external production ingress evidence lane executes.


## workflow_run checkout ordering — 2026-10-04

GitHub's current Actions secure-use guidance warns that privileged `workflow_run` workflows must not process code from untrusted repositories or pull-request forks as trusted code. GitHub's detailed checkout guidance also notes that checkout itself does not execute the checked-out code, but later steps can turn an unsafe checkout into privileged code execution.

Primary sources re-checked on 2026-10-04:
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

The zSSH public-ingress chain already verifies that its upstream production-DNS run succeeded, used branch `main`, and came from the same repository. Those checks do not require repository contents, so performing checkout first is unnecessary trust expansion.

Decision:
- validate `workflow_run` conclusion, branch, and repository identity before `actions/checkout`;
- only after that source gate may the workflow check out the upstream `head_sha`;
- retain `persist-credentials: false`, read-only job permissions, and the existing manual protected-main path;
- add a regression assertion that the source-validation step occurs before checkout.

This is defense in depth: it does not claim that `actions/checkout` alone executes attacker-controlled code. It ensures zSSH rejects a non-canonical `workflow_run` source before materializing that source into the job workspace.
