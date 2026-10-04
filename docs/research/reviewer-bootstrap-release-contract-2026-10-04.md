# Reviewer bootstrap release-variable contract — 2026-10-04

## Context

The submitted zSSH reviewer cases are bound to the canonical fixture files:

- `/srv/zssh-review/sample.txt`
- `/srv/zssh-review/output.txt`

Protected M5 readiness and the final production release config already reject different reviewer paths. The reviewer bootstrap still allowed arbitrary local roots for development and previously rendered those paths as copyable `release_variables`, which could encourage an operator to copy a dev/test fixture into `openai-production` and create avoidable drift.

## Decision

Development and CI may continue creating reviewer fixtures under arbitrary absolute roots. Those fixtures are explicitly marked `release_compatible=false` and emit no production release variables.

Only a fixture whose read and write paths exactly match the submitted canonical paths may emit:

- `ZSSH_REVIEW_FILE=/srv/zssh-review/sample.txt`
- `ZSSH_REVIEW_WRITE_FILE=/srv/zssh-review/output.txt`

The shell bootstrap forwards the same classification instead of reconstructing release variables from local filesystem paths.

## Safety effect

This is a fail-closed operator-handoff change. It does not alter target permissions, OAuth scopes, public tools, reviewer credentials, provider credentials, or runtime file-access policy. It prevents noncanonical dev/test paths from being presented as production configuration.
