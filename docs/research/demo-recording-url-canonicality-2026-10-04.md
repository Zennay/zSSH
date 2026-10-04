# Demo recording URL canonicality — 2026-10-04

## Current primary sources

- https://developers.openai.com/plugins/deploy/submission
  - Initial MCP review requires a video walkthrough and a reviewer-accessible recording URL.
- https://developers.openai.com/plugins/deploy/submission-errors
  - Final remote MCP submission requires a demo-recording URL showing the main use cases and tools across supported platforms.

## Existing zSSH production contract

The canonical production submission probe already rejects `ZSSH_PLUGIN_DEMO_RECORDING_URL` when it contains a URL fragment. A fragment is client-local and is not transmitted in the HTTP request, so it cannot be part of the remotely verified recording resource identity.

Before this change, the earlier M5 readiness classifier and final release-config preflight accepted the same fragmented URL. That allowed a reviewer-fixture lane to appear valid before the final production probe rejected it.

## Decision

- Keep the production probe's existing fragmentless demo-recording contract.
- Reject fragments for `ZSSH_PLUGIN_DEMO_RECORDING_URL` in protected M5 readiness and release-config validation as well.
- Do not broaden this rule to unrelated HTTPS fields in this change.
- Preserve query-string support; only `#fragment` drift is addressed.

This changes validation timing only. It does not alter the public MCP endpoint, OAuth scopes, tool surface, provider credentials, reviewer credentials, or the active external M5 gate.
