# Reviewer fixture production guard — 2026-10-04

## Scope

The submitted reviewer fixture is already contract-bound to `/srv/zssh-review/sample.txt` for reads and `/srv/zssh-review/output.txt` for the write roundtrip. The existing bootstrap intentionally supports a development fixture under the operator home directory and reports that state as `release_compatible=false`.

## Gap

A production operator could run the bootstrap with a non-canonical root, receive a correct secret-safe warning, and still continue unless they manually inspect the JSON report. That is unnecessary operator-error surface in M5.

## Decision

Add an opt-in fail-closed production guard:

```bash
ZSSH_REVIEW_ROOT=/srv/zssh-review \
ZSSH_REVIEW_REQUIRE_RELEASE_COMPATIBLE=1 \
npm run review:target
```

When the guard is enabled, the target bootstrap aborts unless the generated read/write fixture paths exactly match the canonical submission contract. Development behavior remains unchanged when the flag is unset.

## Safety

- No reviewer credential, OAuth token, target private key, or provider secret is added.
- The guard only tightens local fixture preparation; it does not widen the public tool surface or target permissions.
- The reviewer identity remains target-local and the private key is never printed.
- Regression coverage proves that a development fixture is rejected when production enforcement is requested.
