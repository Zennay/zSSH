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

A green local/unit test proves transaction and rollback semantics only. VPS mutation remains in the **zCloud control-plane repository**, not in the zSSH release repository.

The canonical production sequence uses the existing guarded zCloud lanes:

1. **zSSH public gateway activate (zCloud lane)** runs on `[self-hosted, zcloud, vps]`, requires the exact canonical zSSH SHA, `ACTIVATE_ZSSH_PUBLIC_GATEWAY`, the reviewed public origin, and the real OAuth issuer/JWKS URL. It prepares the release-compatible reviewer target, checks out that exact zSSH revision, regression-tests the public gateway installer, and activates isolated `zssh-public.service` on loopback port 8789.
2. **zSSH public ingress bootstrap (zCloud lane)** requires the same exact zSSH SHA and `INSTALL_ZSSH_PUBLIC_INGRESS`. It fails closed unless `zssh.cheapgpt.shop` resolves only to `198.244.191.182`, the isolated public gateway is already healthy, and the Caddy transaction tests pass. It then promotes the canonical Caddy ingress and proves local TLS health.
3. The separate GitHub-hosted **zSSH public ingress external preflight** must run afterward. A green VPS-local rollout is not external reviewer evidence.

This separation is intentional: zSSH owns the immutable release/deployment helpers and readiness contract, while zCloud owns shell/build/test/deploy execution on `vps-bb300bba`.