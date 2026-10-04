# OpenAI reviewer test-case tool binding — 2026-10-04

## Primary sources

- OpenAI plugin submission: https://developers.openai.com/plugins/deploy/submission
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI connect and test guidance: https://developers.openai.com/plugins/deploy/connect-chatgpt

## Current platform requirement

Initial MCP review requires exactly five positive and three negative test cases. Each positive case includes the expected tool names, and OpenAI instructs developers to run the cases and verify that positive prompts select the expected tools against the submitted production MCP surface.

## zSSH risk

zSSH already has a canonical public tool/scope contract in `submission/public-tool-contract.json`, and the live production probe rejects missing or unreviewed tools. The submission manifest separately stores reviewer-facing `tools_triggered` strings. Without a binding between those two artifacts, a future tool rename/removal could leave the production scan green while the reviewer package still names a stale tool.

## Decision

- Treat `submission/public-tool-contract.json` as the canonical reviewed public-tool name set.
- Validate the submission manifest has exactly five positive and three negative reviewer cases.
- Require every positive case to provide non-empty `description`, `prompt`, `tools_triggered`, and `expected_behavior`.
- Parse comma-separated `tools_triggered` values and reject unknown or duplicate tool names.
- Derive the production probe's required tool list from the same public-tool contract rather than maintaining a second hard-coded list.
- Run the reviewer-case binding inside the production submission probe as well as unit tests, so the final production evidence explicitly proves the submitted cases still reference reviewed public tools.

This change does not widen the public tool surface, OAuth scopes, target permissions, provider credentials, or production destination.
