# OpenAI release-note version binding — 2026-10-04

## Primary source check

OpenAI's current plugin submission guidance says that review information includes release notes that summarize the package version being submitted and what changed:

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors

Checked: 2026-10-04 UTC.

## Gap

zSSH already required non-empty `publication.release_notes`, but the current `0.1.2` text described the changes without naming the package version. That leaves package/version provenance weaker than the submission contract and makes a future version bump easier to ship with stale release notes.

## Decision

The submission builder now fails closed unless `publication.release_notes` contains the exact `plugin.version` value. The canonical `0.1.2` release note is updated to name `0.1.2` explicitly.

This is deliberately package-local validation: it does not fabricate portal state, reviewer credentials, or production endpoint evidence.

## Regression coverage

`scripts/openai-submission-contract-canary.py` now proves:

- empty release notes fail;
- non-empty release notes that omit the exact plugin version fail;
- the canonical versioned release note remains valid.

The existing builder check that `submission/plugin.template.json` and `package.json` versions match remains in force.
