# OpenAI annotation justification binding — 2026-10-04

## Primary sources

- https://developers.openai.com/plugins/plugin-guidelines
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/plugins/deploy/submission-errors

## Current platform state

OpenAI's current plugin guidance requires every public MCP tool to advertise explicit boolean `readOnlyHint`, `destructiveHint`, and `openWorldHint` values. The review flow also exposes or requests per-tool rationale when annotation behavior needs review. Current documentation is not perfectly uniform about whether a justification is always mandatory, so zSSH keeps the reviewer rationale as a fail-closed release artifact rather than relying on prose to override server annotations.

## Gap

zSSH already maintained `docs/openai-annotation-justifications.md`, but it was a manually maintained table. A public tool could be added, removed, or have an annotation changed while that reviewer document silently stayed stale.

## Decision

The live public tool scan is authoritative. CI and the production submission probe now parse the reviewer table and require:

1. exactly one reviewer row for every live public tool;
2. no stale rows for tools that are not in the live public scan;
3. exact equality between the documented and live `readOnlyHint`, `destructiveHint`, and `openWorldHint` booleans;
4. non-trivial rationale text for each annotation;
5. a deterministic SHA-256 over the exact reviewer rows.

The production release evidence records that SHA-256. The rationale never changes server behavior and cannot compensate for an incorrect annotation; the release must first advertise the correct tool metadata.
