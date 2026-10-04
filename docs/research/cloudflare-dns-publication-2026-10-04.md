# Cloudflare production DNS publication — 2026-10-04

## Scope

zSSH M5 is blocked on one concrete ingress prerequisite: the public production hostname must resolve directly to the VPS before the existing Caddy/public-gateway activation and external ingress proof can run. The selected origin is `https://zssh.cheapgpt.shop` and the expected direct IPv4 is `198.244.191.182`.

This note covers only controlled publication of that DNS-only A record. Production OAuth/OIDC, reviewer credentials, Caddy activation, OpenAI Verify Domain / Scan Tools, live ChatGPT review and final submission remain separate gates.

## Primary-source refresh

- Cloudflare DNS record API:
  - https://developers.cloudflare.com/api/resources/dns/subresources/records/
  - create: `POST /zones/{zone_id}/dns_records`
  - update: `PATCH /zones/{zone_id}/dns_records/{dns_record_id}`
- Cloudflare zone lookup API:
  - https://developers.cloudflare.com/api/resources/zones/methods/list/
  - exact-name zone discovery uses `GET /zones?name=cheapgpt.shop` and requires `Zone Read`.
- Cloudflare API token permissions:
  - https://developers.cloudflare.com/fundamentals/api/reference/permissions/
  - `Zone Read` and DNS write are Zone permissions and can both be scoped to one zone.
- Cloudflare token creation guidance:
  - https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
  - prefer API tokens over the legacy global API key and scope the token to the minimum required zone/resource.

## Engineering decision

Add a manual, protected GitHub Actions lane backed by a small repository-owned reconciler.

The reconciler:

1. requires the existing validated zSSH public HTTPS origin and derives the exact DNS hostname from it;
2. requires a publicly routable IPv4 and reuses zSSH's existing public-address classification;
3. requires a bearer API token; when `CLOUDFLARE_ZONE_ID` is absent it discovers the exact active `cheapgpt.shop` zone by name using `Zone Read`, while a configured 32-character zone ID remains a backward-compatible override;
4. proves the public hostname belongs to the configured zone name before zone autodiscovery, then reads the exact hostname before any write;
5. refuses CNAME/NS conflicts and refuses to collapse a multi-A RRset;
6. creates or updates only one A record;
7. forces `proxied: false` so the production origin is a direct DNS/TLS endpoint as required by the current zSSH ingress design;
8. is idempotent and returns `noop` when the desired state already exists;
9. never prints the API token or zone ID in its evidence output;
10. never overwrites an unexpected existing A record: a replacement requires `ZSSH_DNS_EXPECTED_CURRENT_IPV4` to exactly match the reviewed current value, while an unconfigured dry-run reports `would_update_requires_precondition` plus the non-secret previous IPv4/proxy state.

The workflow runs in the protected `openai-production` environment. Its production destination is repository-locked to `https://zssh.cheapgpt.shop` / `198.244.191.182` / zone `cheapgpt.shop`; manual dispatch cannot substitute another hostname or address. Manual dispatch is also bound to `refs/heads/main`, merged-PR provenance, live branch protection, and the exact current GitHub-reported main SHA before the protected environment may mutate DNS, then requires the explicit phrase `PUBLISH_ZSSH_PRODUCTION_DNS`. A reviewed canonical-main activation may also run through the dedicated `.github/openai-production-dns-trigger` marker after provenance and branch-protection checks pass. Both paths perform a dry-run first, apply the change, re-read Cloudflare, require an idempotent `noop` result, and then prove external DNS convergence.

## Workflow dependency integrity

Because this lane can mutate production DNS, its reusable GitHub Actions are pinned to immutable commit SHAs rather than mutable major-version tags. The current pins correspond to the reviewed v4 releases of `actions/checkout`, `actions/setup-node`, and `actions/upload-artifact`; a regression test rejects a return to `@vN` refs in the production DNS workflow. Future action upgrades therefore require an explicit zSSH code review and a fresh protected-main validation cycle.

## Required protected configuration

- environment secret: `CLOUDFLARE_API_TOKEN`
- preferred token scope: only the `cheapgpt.shop` zone with `Zone Read` + DNS write permission
- optional compatibility variable: `CLOUDFLARE_ZONE_ID` for a DNS-write-only token; when absent, zSSH discovers the zone ID without printing it
- optional safety variable: `ZSSH_DNS_EXPECTED_CURRENT_IPV4`; leave it unset when the hostname has no A record or is already exactly correct, and set it only to the independently reviewed current IPv4 when intentionally replacing an existing A record
- the production workflow pins `CLOUDFLARE_ZONE_NAME=cheapgpt.shop`; the generic repository CLI still accepts a zone-name override for non-production testing

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
- The provider gate is now reduced to one preferred external secret: a zone-scoped Cloudflare token with `Zone Read` + DNS write. A manually supplied zone ID is no longer required for the recommended path. DNS publication still remains an external credential gate until that token is provided.


## Operator cutover checklist — canonical manual path

Use this sequence once the external Cloudflare credential has been created. It is intentionally secret-safe: no token value belongs in commits, issues, artifacts, logs, or Notion.

1. In Cloudflare, create a dedicated API token scoped only to the `cheapgpt.shop` zone with `Zone Read` and DNS write permission. Do not use the Global API Key.
2. In the GitHub `openai-production` environment, store that value only as the protected secret `CLOUDFLARE_API_TOKEN`. Leave `CLOUDFLARE_ZONE_ID` unset on the preferred path; it exists only for the legacy DNS-write-only token mode.
3. Check whether `zssh.cheapgpt.shop` already has an A record. If it is absent, leave `ZSSH_DNS_EXPECTED_CURRENT_IPV4` unset. If an existing A record must intentionally be replaced, independently verify its current IPv4 in Cloudflare and store that exact non-secret value as the protected environment variable `ZSSH_DNS_EXPECTED_CURRENT_IPV4`. Never guess this value.
4. Dispatch **zSSH production DNS publish** from canonical `main` and enter the exact confirmation phrase `PUBLISH_ZSSH_PRODUCTION_DNS`.
5. Treat the run as green only when all of these stages succeed in order:
   - merged-PR provenance and current protected-main verification;
   - non-mutating Cloudflare plan;
   - exact DNS-only A-record publication;
   - Cloudflare re-read returning the idempotent `noop` state;
   - external DNS observation advancing beyond the `dns` stage.
6. Retain the workflow artifact. It should contain the plan, mutation result, post-write verification, and public-origin observation JSON. These are non-secret evidence and must not contain the API token or zone ID.
7. If the workflow fails before the publish step, correct the protected configuration and dispatch again; no DNS mutation should have occurred.
8. If publication succeeds but the bounded external convergence check times out, rerun the same canonical workflow rather than making an ad-hoc DNS change. The reconciler is intentionally idempotent and will prove the already-correct Cloudflare state before checking public resolution again.
9. After DNS is externally resolvable, continue the M5 sequence with isolated public-gateway/Caddy activation and the GitHub-hosted external ingress preflight. Do not skip directly to OAuth or portal evidence while the public MCP origin is still unproven.

The managed GitHub issue `#159` remains the machine-updated source for the active M5 gate. When the protected readiness audit advances it away from `dns_publication`, this checklist has served its purpose and the next gate becomes authoritative.
