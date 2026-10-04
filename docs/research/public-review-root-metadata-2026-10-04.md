# Public reviewer root metadata consistency — 2026-10-04

## Current primary sources

- https://developers.openai.com/plugins/build/mcp-server
  - Public plugin submission requires a stable, publicly reachable HTTPS MCP server and asks developers to verify the advertised tools, schemas, annotations, authentication, results, and errors against the production endpoint.
- https://developers.openai.com/plugins/deploy/app-review
  - Remote MCP review imports the server/tool metadata into the submission draft and requires the reviewer-facing MCP configuration and test material to describe the production integration accurately.
- https://developers.openai.com/plugins/deploy/submission
  - Submission requires the production MCP server to connect successfully, complete domain verification, scan tools, and provide the reviewer materials used for review.

## Repository finding

The positive reviewer file-read case in `submission/plugin.template.json` described the allowed root as `ZSSH_ALLOWED_ROOTS`. That name belongs to the private/operator boundary. The public plugin profile is intentionally isolated behind `ZSSH_PUBLIC_ALLOWED_ROOTS`.

The executable public deployment, canary, and documentation already use `ZSSH_PUBLIC_ALLOWED_ROOTS`; only the submitted review-case wording had drifted.

## Decision

- Change the reviewer-facing expected behavior to name `ZSSH_PUBLIC_ALLOWED_ROOTS`.
- Add a submission-contract canary that fails if positive public review cases mention the private `ZSSH_ALLOWED_ROOTS` name or stop naming `ZSSH_PUBLIC_ALLOWED_ROOTS`.
- Do not change runtime permissions, roots, OAuth scopes, tool schemas, or the external M5 gate sequence.

This is submission-metadata hardening only. The live M5 blocker remains protected Cloudflare DNS publication evidence.
