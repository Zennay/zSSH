# Cloudflare production DNS publication — 2026-10-04

## Scope

zSSH M5 is blocked on one concrete ingress prerequisite: the public production hostname must resolve directly to the VPS before the existing Caddy/public-gateway activation and external ingress proof can run. The selected origin is `https://zssh.cheapgpt.shop` and the expected direct IPv4 is `198.244.191.182`.

This note covers only controlled publication of that DNS-only A record. Production OAuth/OIDC, reviewer credentials, Caddy activation, OpenAI Verify Domain / Scan Tools, live ChatGPT review and final submission remain separate gates.

## Primary-source refresh

- Cloudflare DNS record API:
  - https://developers.cloudflare.com/api/resources/dns/subresources/records/
  - create: `POST /zones/{zone_id}/dns_records`
  - update: `PATCH /zones/{zone_id}/dns_records/{dns_record_id}`
- Cloudflare API token permissions:
  - https://developers.cloudflare.com/fundamentals/api/reference/permissions/
  - DNS write access is a Zone permission and can be scoped to one zone.
- Cloudflare token creation guidance:
  - https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
  - prefer API tokens over the legacy global API key and scope the token to the minimum required zone/resource.

## Engineering decision

Add a manual, protected GitHub Actions lane backed by a small repository-owned reconciler.

The reconciler:

1. requires the existing validated zSSH public HTTPS origin and derives the exact DNS hostname from it;
2. requires a publicly routable IPv4 and reuses zSSH's existing public-address classification;
3. requires a 32-character Cloudflare zone ID and bearer API token;
4. reads the exact hostname before any write;
5. refuses CNAME/NS conflicts and refuses to collapse a multi-A RRset;
6. creates or updates only one A record;
7. forces `proxied: false` so the production origin is a direct DNS/TLS endpoint as required by the current zSSH ingress design;
8. is idempotent and returns `noop` when the desired state already exists;
9. never prints the API token or zone ID in its evidence output.

The workflow runs in the protected `openai-production` environment. Manual dispatch requires the explicit phrase `PUBLISH_ZSSH_PRODUCTION_DNS`; a reviewed canonical-main activation may also run through the dedicated `.github/openai-production-dns-trigger` marker after main-provenance and branch-protection checks pass. Both paths perform a dry-run first, apply the change, re-read Cloudflare, require an idempotent `noop` result, and then prove external DNS convergence.

## Required protected configuration

- environment variable: `CLOUDFLARE_ZONE_ID`
- environment secret: `CLOUDFLARE_API_TOKEN`
- token scope: only the `cheapgpt.shop` zone with DNS write permission

The token is an external credential and is intentionally not stored in the repository.

## Release sequence after DNS is green

1. publish/verify `zssh.cheapgpt.shop -> 198.244.191.182` as DNS-only;
2. activate the isolated zSSH public gateway on loopback port 8789;
3. promote the zSSH Caddy site;
4. run the GitHub-hosted external ingress preflight against `https://zssh.cheapgpt.shop/mcp`;
5. continue with production OAuth/reviewer and OpenAI portal gates.


## Live execution evidence — 2026-10-04 06:34 UTC

- Canonical production DNS run `37181262867` reached the reviewed protected-main gate successfully, then failed closed in the pre-mutation validation step because both protected Cloudflare inputs were absent. The recorded validator error was `CLOUDFLARE_ZONE_ID must be a 32-character hexadecimal zone ID`; the publish step was skipped, so no DNS mutation occurred.
- The deterministic non-secret zSSH release variables are independent of this provider gate. zCloud run `37182568488` successfully seeded and read back `ZSSH_PLUGIN_MCP_URL`, `ZSSH_REVIEW_FILE`, and `ZSSH_REVIEW_WRITE_FILE` in the zSSH `openai-production` environment.
- A separate zCloud self-hosted capability probe now checks whether `vps-bb300bba` already has a reusable Cloudflare API or Wrangler session. That probe is read-only: it performs token verification / zone lookup GETs and `wrangler whoami`, emits only boolean capability evidence, and never publishes DNS or copies a provider credential into zSSH.
- Until either the protected Cloudflare inputs are supplied or that existing-session probe proves a safe reusable provider session, DNS publication remains an external credential gate rather than a missing zSSH implementation step.
