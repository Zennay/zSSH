# Submission builder public-hostname parity — 2026-10-04

## Current OpenAI sources

- https://developers.openai.com/plugins/build/mcp-server
  - Public plugin submission requires a stable, publicly reachable HTTPS MCP endpoint. Local endpoints and temporary/private tunnels do not satisfy the public submission requirement.
- https://developers.openai.com/plugins/deploy/app-review
  - A remote MCP server submitted for public review must be hosted on a publicly accessible domain and must not use a local or testing endpoint.
- https://developers.openai.com/plugins/deploy/submission
  - MCP review metadata includes HTTPS listing URLs and a reviewer-accessible video walkthrough URL; reviewer credentials and test material must let the review team exercise the integration.

## Repository finding

The protected M5 readiness path already rejects non-public hostnames for the production MCP endpoint, reviewer login, OAuth issuer, portal evidence and demo recording URL. The standalone ZIP builder only checked HTTPS syntax, credentials, query/fragment canonicality and the `/mcp` path.

That left a packaging-only bypass: a manual build could still create a syntactically valid submission artifact using localhost, an IP address, a single-label hostname, or a reserved/test hostname such as `*.example`. The artifact would then fail only at a later protected gate or during review.

## Decision

Make the submission builder enforce the same public-hostname shape before writing the ZIP:

- reject IP-literal hosts;
- reject localhost/single-label hosts;
- reject reserved/testing suffixes already treated as non-public by the JavaScript release contract;
- require the same rule for the MCP URL, demo recording URL and all generated/listing HTTPS URLs;
- keep network fetching out of the build step: this is fail-closed hostname-shape validation, while live reachability remains the protected ingress/submission-probe responsibility.

CI now builds its reproducibility fixture with the production-shaped `zssh.cheapgpt.shop` hostname rather than a reserved `.example` endpoint, without performing network access.

This changes packaging validation only. It does not publish DNS, alter OAuth scopes, expose credentials, widen the public tool surface or change target permissions. The first live M5 gate remains protected Cloudflare DNS publication.
