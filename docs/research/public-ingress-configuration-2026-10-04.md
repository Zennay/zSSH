# Public ingress configuration hardening — 2026-10-04

## Primary-source refresh

- https://developers.openai.com/plugins/build/mcp-server
  - Public plugin submission requires a stable, publicly reachable HTTPS MCP endpoint.
  - A development tunnel alone does not satisfy public submission.
- https://developers.openai.com/plugins/deploy/submission
  - MCP connection setup uses the production server URL, domain verification, authentication when required, and a current tool scan.
  - Domain verification serves the exact challenge token over HTTPS on the MCP hostname or an eligible parent origin.
- https://developers.openai.com/plugins/deploy/app-review
  - Public remote MCP submissions must use a publicly accessible production domain rather than a local/testing endpoint.
  - A universal MCP URL is the normal directory architecture.

## Engineering decision

The repository previously shipped a safe public Caddy example that correctly targets the isolated `zssh-public.service` loopback port 8789, but activation still depended on manually replacing the placeholder hostname. That leaves an avoidable release-time footgun: the operator can accidentally retain a documentation hostname, use a local/non-HTTPS origin, include a path/query, or point the public site at the private 8788 service.

Add `scripts/render-public-caddy.mjs` as the canonical renderer for production public ingress. It:

- accepts only `ZSSH_PUBLIC_BASE_URL` as a clean HTTPS origin on a DNS hostname;
- rejects local, IP-literal, reserved and `example.com` placeholder hosts;
- rejects non-standard public URL ports;
- defaults upstream to the isolated public loopback port 8789;
- explicitly refuses private `zssh.service` port 8788;
- emits configuration to stdout only, leaving privileged installation/reload to the existing guarded deployment path.

The renderer does not claim that DNS resolves, TLS has been issued, OAuth exists, or OpenAI portal verification is complete. Those remain real production gates and must be proven by the existing production submission probe and portal attestations.

## Acceptance evidence

- Unit tests cover valid rendering, custom isolated port handling, unsafe origins, the 8788 isolation boundary and CLI fail-closed behavior.
- The OpenAI public release contract workflow syntax-checks the renderer and runs its tests.
- Pull-request and push path filters include both renderer and test, preserving release-gate trigger parity.


## DNS trailing-dot normalization follow-up

The canonical Caddy renderer now normalizes one terminal DNS root dot before classifying or rendering the public hostname. This keeps ingress behavior aligned with the shared M5 public-hostname contract: a legitimate absolute DNS spelling such as `mcp.zssh.dev.` is rendered as `mcp.zssh.dev`, while reserved hosts such as `example.com.` or `gateway.local.` cannot bypass the existing fail-closed checks.

This is local configuration validation only. It does not perform DNS resolution, request certificates, mutate provider state, or mark the live ingress gate complete.
