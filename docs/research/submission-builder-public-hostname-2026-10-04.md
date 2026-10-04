# Submission builder public-hostname parity — 2026-10-04

## Current OpenAI sources

- https://developers.openai.com/plugins/build/mcp-server
  - Public plugin submission requires a stable, publicly reachable HTTPS MCP endpoint; local endpoints and temporary/private tunnels do not satisfy public submission.
- https://developers.openai.com/plugins/deploy/app-review
  - Public remote-MCP review requires the server to be hosted on a publicly accessible domain and not use a local or testing endpoint.
- https://developers.openai.com/plugins/deploy/submission
  - MCP review includes HTTPS listing URLs and a reviewer-accessible video walkthrough URL.

## Repository finding

Protected M5 readiness already requires public DNS hostnames, and the central JavaScript release contract is being hardened to reject IPv4/IPv6 literals. The standalone ZIP-builder still only checked HTTPS syntax plus URL canonicality.

A manual package could therefore be built with localhost, an IP literal, a single-label hostname or a reserved testing domain, only to fail later during protected readiness or public review.

## Decision

The artifact-building entry point now rejects non-public hostname shapes before writing the ZIP:

- IP literals;
- localhost and single-label names;
- reserved/testing suffixes already treated as non-public elsewhere in zSSH.

The MCP and demo URL arguments are both checked. Generated listing URLs inherit the already-validated MCP origin. Live reachability remains the job of the protected ingress and final production probe; the builder performs no network access.

CI uses the production-shaped `zssh.cheapgpt.shop` hostname for deterministic package generation instead of a reserved `.example` hostname.

This is validation-only hardening. It does not publish DNS, expose credentials, widen tools, alter OAuth scopes or change target permissions.
