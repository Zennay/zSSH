# Submission builder URL canonicality — 2026-10-04

## Current primary sources

- https://developers.openai.com/plugins/deploy/submission
  - Remote MCP submissions require a production HTTPS MCP server and reviewer-facing submission metadata, including the demo recording used during review.
- https://developers.openai.com/plugins/deploy/app-review
  - Public review expects a real, publicly accessible production MCP endpoint rather than a local/testing endpoint.
- https://developers.openai.com/plugins/deploy/submission-errors
  - Final remote-MCP submission requires a production HTTPS MCP server URL plus a reviewer-accessible demo-recording URL.

## Repository finding

The protected readiness audit and final production probe already reject URL-fragment drift. The canonical MCP release contract also rejects query parameters and fragments. However, `scripts/build-openai-plugin.py` still accepted:

- an MCP URL such as `https://host.example/mcp?tenant=stale`;
- an MCP URL such as `https://host.example/mcp#fragment`;
- a demo recording URL with a client-local `#fragment`.

That allowed a manually built submission ZIP to encode URL identities that the later protected M5 release path would reject.

## Decision

Keep query strings supported for the reviewer demo URL, because they can be part of a real remotely fetched resource. Reject demo URL fragments because fragments are client-local and are not sent to the server.

For the MCP endpoint, reject both query parameters and fragments. The public zSSH contract is one canonical `/mcp` endpoint, and the protected release contract already enforces the same invariant.

Regression coverage lives in `scripts/openai-submission-contract-canary.py`.

This is packaging-contract hardening only. It does not change the live MCP endpoint, OAuth scopes, reviewer credentials, provider credentials, or target permissions. The first live M5 gate remains protected Cloudflare DNS publication.
