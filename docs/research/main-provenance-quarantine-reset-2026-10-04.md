# Main provenance quarantine reset — 2026-10-04

## Decision

Reset the canonical zSSH main-provenance baseline from `15990579bd3bcc2ecf3b41849892247039585db6` to the merged quarantine-recovery commit `121411d24e288c2512d4851e973a0af80aa99733` (PR #97).

This is a one-time trust-anchor move after a verified repository-boundary incident. The provenance algorithm remains strict: every first-parent commit from the new baseline forward must still be the merge commit of an associated merged pull request.

## Incident

A direct commit `25f1d28494f60ca057acda2d5223bbb91c2f3ecb` landed on `main` with a cross-project workflow:

- path: `.github/workflows/ftmo-pr521-runner-recovery-haxlab.yml`;
- operated the separate `Zennay/Ftmo` repository;
- targeted a self-hosted HaxLab runner;
- requested `contents: write`;
- contained a direct `git push` path back to canonical zSSH `main`.

That violated the documented zSSH release-repository boundary and correctly caused the existing repository-hygiene and provenance checks to fail.

## Quarantine and repair

PR #97 removed the foreign workflow and strengthened `scripts/check-repo-hygiene.mjs` so release workflows fail closed on:

- explicit FTMO/zCloud/HaxLab/RaiseAI repository references;
- foreign operational environment contracts;
- repository `contents: write` permission;
- workflow-level `git push`;
- self-hosted runner execution.

PR #97 was squash-merged as `121411d24e288c2512d4851e973a0af80aa99733`.

The historical workflow run created by the bad direct commit, run `37177345220`, remained queued after the workflow file was removed. It was cancelled with an exact run-id + head-SHA + workflow-path guard through temporary draft PR #101. PR #101 was closed without merge after the target run reached `completed / cancelled`.

## Why the baseline must move

The provenance checker intentionally walks first-parent history and rejects any direct commit between the current head and its configured trust baseline. Keeping the pre-incident baseline would therefore make every future canonical main provenance run fail forever on `25f1d284...`, even though the unsafe content has been removed and its queued execution was cancelled.

Using the merged repair commit as the new trust anchor does not whitelist the bad direct commit. It quarantines history before a known-good, review-backed recovery point and resumes strict merged-PR provenance from that point onward.

## Invariants retained

- Direct commits after the new baseline remain rejected.
- The checker implementation is not weakened or given an exception SHA.
- The new baseline itself is a merged-PR commit.
- zSSH release workflows remain GitHub-hosted and read-only with respect to repository contents.
- Cross-project operational workflows remain outside the zSSH release repository.

## Evidence

- Bad direct commit: `25f1d28494f60ca057acda2d5223bbb91c2f3ecb`.
- Quarantined historical run: `37177345220` → `completed / cancelled`.
- Recovery PR: #97.
- Recovery merge: `121411d24e288c2512d4851e973a0af80aa99733`.
- Temporary cancellation PR: #101, closed without merge.
- Before this baseline reset, current main zSSH CI and OpenAI public release gate were green while Canonical main provenance failed only on the quarantined direct commit.
