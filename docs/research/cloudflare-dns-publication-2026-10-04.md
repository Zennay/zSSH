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

The workflow is manual-only, runs in the protected `openai-production` environment, requires the explicit phrase `PUBLISH_ZSSH_PRODUCTION_DNS`, performs a dry-run first, applies the change, then re-reads Cloudflare and requires an idempotent `noop` result.

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
