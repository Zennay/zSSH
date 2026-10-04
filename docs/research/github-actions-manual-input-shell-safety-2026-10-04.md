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
