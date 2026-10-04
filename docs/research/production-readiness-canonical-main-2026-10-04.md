# Production readiness canonical-main binding — 2026-10-04

## M5 invariant

The protected OpenAI production readiness audit reads release secrets and writes the managed active-blocker issue. Its evidence must therefore describe the exact current canonical release revision.

Before the `openai-production` environment is entered:

- manual `workflow_dispatch` must originate from `refs/heads/main`;
- the candidate SHA must have merged-PR provenance;
- GitHub must report `main` protected;
- the executing `GITHUB_SHA` must equal GitHub's exact current `main` SHA;
- immutable repository-governance negative-proof evidence must remain valid.

The exact-current-SHA requirement applies to both manual and merged-PR-triggered readiness runs. If another merge advances `main` while an older readiness run is queued or executing, the stale run fails closed before protected release inputs are classified or issue #159 can be synchronized.

## Why

The readiness workflow is not only observational: it consumes protected environment values and maintains the canonical M5 handoff issue. A historically valid merged commit is insufficient evidence once `main` has advanced.

## Regression guard

`test/production-readiness-audit.test.mjs` requires the manual main-ref guard and the exact-current protected-main verification before the protected audit job.
