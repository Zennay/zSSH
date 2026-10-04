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

A green local/unit test proves transaction and rollback semantics only. Live VPS mutation is deliberately owned by the **Zennay/zCloud control plane**, not this release repository. The zSSH repository must remain free of self-hosted/VPS execution workflows.

After guarded production DNS convergence, use the existing zCloud lanes in this order:

1. **zSSH public gateway activate (zCloud lane)** — bind to the exact current canonical zSSH SHA, require the real production HTTPS origin plus OAuth issuer/JWKS, prepare the bounded reviewer target, run installer regression evidence and activate only the isolated loopback `zssh-public.service`.
2. **zSSH public ingress bootstrap (zCloud lane)** — require the same exact canonical zSSH SHA, exact DNS to `198.244.191.182`, a healthy loopback gateway and explicit `INSTALL_ZSSH_PUBLIC_INGRESS`, then perform the transactional Caddy promotion on `vps-bb300bba`.
3. **zSSH public ingress external preflight** — run from GitHub-hosted infrastructure after the VPS mutation to prove public TLS, health, MCP authentication and OAuth metadata from outside the server.

Readiness must not report the VPS rollout as internally executable while the real production `ZSSH_OAUTH_ISSUER` is absent. Placeholder issuers and duplicate self-hosted workflows in zSSH are rejected by design.
