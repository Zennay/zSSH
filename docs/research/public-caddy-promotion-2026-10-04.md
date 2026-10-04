# Transactional public Caddy promotion — 2026-10-04

## Scope

This note records the production-ingress decision for zSSH M5. It covers only promotion of the already-rendered public Caddy site to the existing system Caddy service. DNS ownership, production OAuth/OIDC, reviewer credentials, OpenAI portal verification and submission remain separate gates.

## Primary-source refresh

- Caddy command-line documentation: https://caddyserver.com/docs/command-line
  - `caddy reload` is the semantic configuration-change path for a running Caddy instance.
  - Reload uses Caddy's admin API and does not require stop/start downtime.
- Caddy getting-started documentation: https://caddyserver.com/docs/getting-started
  - Configuration reloads are graceful; if a newly loaded configuration fails, the running configuration remains available.
- Caddy service documentation: https://caddyserver.com/docs/running
  - For the official systemd service, the documented file-based production operation is `sudo systemctl reload caddy`; stopping the service for config changes causes downtime.
- Caddy `import` directive: https://caddyserver.com/docs/caddyfile/directives/import
  - Files can be imported into the root Caddyfile before normal parsing, including via file paths/globs.

## Engineering decision

zSSH will not replace the whole Caddy deployment model or restart Caddy. The canonical promotion helper:

1. renders the zSSH public site from `ZSSH_PUBLIC_BASE_URL` and the isolated loopback gateway port;
2. preserves the existing root Caddyfile byte-for-byte except for one bounded, uniquely marked zSSH import block;
3. keeps the zSSH site in a dedicated `zssh-public.caddy` snippet;
4. rejects symlinked root/snippet paths and malformed/duplicate managed markers;
5. stages writes on the same filesystem, preserving root config ownership/mode;
6. validates the resulting root Caddyfile before any reload;
7. uses the existing systemd service's graceful reload path;
8. restores the prior root/snippet files and reloads the previous config if reload fails;
9. supports a validate-only mode that renders the exact public site without privileged mutation.

The helper deliberately requires non-interactive sudo and an already-active Caddy service. It does not create DNS records, start/replace the Caddy service, or fabricate production OAuth inputs.

## Release boundary

A green local/unit test proves transaction and rollback semantics only. Live promotion is executed by the guarded **zSSH public gateway and Caddy rollout** workflow on the canonical self-hosted VPS runner.

The workflow is manual and fail-closed:

1. it requires exact confirmation `PROMOTE_ZSSH_PUBLIC_INGRESS`;
2. GitHub-hosted provenance verifies merged-PR ancestry, protected `main`, the immutable negative-proof evidence and exact current SHA before the protected environment is entered;
3. the self-hosted runner repeats the exact-current-main check immediately before mutation;
4. `zssh.cheapgpt.shop` must resolve only to the reviewed production IPv4 `198.244.191.182`;
5. the production OAuth issuer must already be configured; the JWKS URL is derived from that issuer for the Auth0-backed public gateway;
6. the reviewer target is derived from the local one-target trust file and public access remains rooted at `/srv/zssh-review`;
7. both gateway and Caddy helpers run their validate-only paths before mutation;
8. the isolated `zssh-public.service` is promoted first and remains loopback-only; only then is the transactional Caddy import promoted;
9. local systemd/Caddy/health checks must pass before the workflow reports green.

A successful VPS rollout is still not external-review evidence. The separate GitHub-hosted **zSSH public ingress external preflight** must run afterward to prove public TLS, health, MCP authentication and OAuth metadata from outside the VPS.
