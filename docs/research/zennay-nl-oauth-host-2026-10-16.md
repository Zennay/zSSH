# zSSH production hostname: zssh.zennay.nl

Date: 2026-10-16

## Decision

Use **`zssh.zennay.nl`** for the zSSH OAuth/MCP endpoint. Keep the existing portfolio at `zennay.nl` untouched.

A subdomain is a separate DNS hostname. Publishing `zssh.zennay.nl` does not require replacing the apex (`zennay.nl`) website record or changing its hosting. Do not alter the apex A/AAAA/CNAME records or nameservers as part of this rollout.

## Intended endpoint and DNS

- Canonical public origin: `https://zssh.zennay.nl`
- ChatGPT MCP URL: `https://zssh.zennay.nl/mcp`
- VPS IPv4: `198.244.191.182`
- DNS record: `A` for `zssh.zennay.nl` → `198.244.191.182`
- Proxy mode: DNS-only / unproxied (`proxied: false`) for the current zSSH ingress design
- TTL: provider automatic TTL where supported

Before creating the record, inspect whether `zssh.zennay.nl` already has A, AAAA, CNAME, HTTPS, NS, or SVCB records. Do not overwrite a conflicting record without reviewing it. The existing zSSH DNS reconciler fails closed on conflicting records and requires an explicit current-IPv4 precondition before replacing an existing A record.

## Existing protected GitHub environment

In `Zennay/zSSH` → Settings → Environments → `openai-production`, set these **non-secret variables** to the approved host:

```dotenv
ZSSH_DNS_PUBLIC_BASE_URL=https://zssh.zennay.nl
ZSSH_DNS_ZONE_NAME=zennay.nl
ZSSH_DNS_APPROVED_HOSTNAME=zssh.zennay.nl
ZSSH_DNS_TARGET_IPV4=198.244.191.182
```

Only if `zennay.nl` DNS is already hosted on Cloudflare, provide a new least-privilege Cloudflare API token as the protected environment secret `CLOUDFLARE_API_TOKEN`. Scope it to the `zennay.nl` zone with **Zone → Zone → Read** and **Zone → DNS → Edit**. Set `CLOUDFLARE_ACCOUNT_ID` only for an account-owned token. Never put the token in Git, Notion, issue comments, logs, or chat.

**Do not migrate the portfolio's nameservers to Cloudflare just to satisfy this runbook.** If DNS for `zennay.nl` is hosted elsewhere, keep the existing DNS provider and adapt the guarded publication step to that provider, or have the operator create only the `zssh` record there. Do not claim the Cloudflare lane is green unless the domain is actually present in the configured Cloudflare account and the protected token verifies.

## OAuth deployment sequence

1. Confirm the current DNS provider and inspect existing records for `zssh.zennay.nl`.
2. Publish only the subdomain A record to `198.244.191.182`; do not touch the apex portfolio.
3. Prove public DNS resolution and issue a valid HTTPS certificate for `zssh.zennay.nl`.
4. Activate the isolated zSSH public gateway and Caddy ingress through the existing guarded zCloud deployment lanes.
5. Prove `https://zssh.zennay.nl/health`, unauthenticated MCP `401`, and protected-resource OAuth metadata externally.
6. Complete the actual OAuth issuer/JWKS checks and target-agent pairing. OAuth login alone must not grant Linux target access.
7. Add a **separate** ChatGPT MCP connection with URL `https://zssh.zennay.nl/mcp` and authentication set to OAuth. Keep the existing private capability-link connection unchanged.

A DNS record or healthy HTTPS page alone is not proof that the OAuth connection is ready. The public gateway, OAuth metadata/issuer, local pairing, and ChatGPT tool scan must all pass before calling this live.


## Observed DNS provider and migration caution — 22 October 2026

**Verified public resolver observations from the existing connected VPS:**

- Authoritative nameservers for `zennay.nl`: `ns1.site.eu`, `ns2.site.nl`, `ns3.site.be`, `ns4.site.de`. The zone is **not delegated to Cloudflare**.
- Both Google DNS and Cloudflare DNS-over-HTTPS resolve `zssh.zennay.nl` to the existing IPv4 `198.244.191.182`.
- `https://zssh.zennay.nl/health` currently responds HTTP 404 via Caddy. This proves only external HTTPS reachability to a Caddy route, **not** a functioning public zSSH OAuth/MCP gateway.
- The replacement SeedHost VPS in the zCloud migration plan is `95.211.40.88`; no owner-approved DNS flip or independent public-gateway/ingress acceptance on that server has been established.

**Correct next step:** manage the `zssh` DNS record through the current `site.eu/site.nl` authoritative provider; do **not** create a Cloudflare API token or change apex records/nameservers. Preserve the existing A record while the new server is unverified. Only after proving the new isolated public gateway, HTTPS ingress, OAuth issuer/JWKS and target routing should an explicitly authorized, single-record A change point `zssh.zennay.nl` to the verified replacement VPS. Reconfirm external A/AAAA/CNAME answers afterwards.

**External DNS readiness (PR #390):** The protected M5 audit now supports `ZSSH_DNS_PROVIDER=external` and refuses to advance its DNS gate unless `scripts/observe-external-provider-dns.mjs` independently confirms the approved hostname, exact A record, authoritative nameservers and absence of conflicting CNAME/AAAA records. Configure `ZSSH_DNS_EXPECTED_NAMESERVERS=ns1.site.eu,ns2.site.nl,ns3.site.be,ns4.site.de` together with the approved `ZSSH_DNS_ZONE_NAME=zennay.nl`, `ZSSH_DNS_APPROVED_HOSTNAME=zssh.zennay.nl`, `ZSSH_DNS_PUBLIC_BASE_URL=https://zssh.zennay.nl`, and an IP that **actually matches the current authorized release destination**. Set `ZSSH_PLUGIN_MCP_URL=https://zssh.zennay.nl/mcp` in the protected environment and `ZSSH_PUBLIC_OBSERVATION_URL=https://zssh.zennay.nl/mcp` in the repository variables used by the observation job. The obsolete `cheapgpt.shop` values must not be used. The first rollout remains blocked until actual new-VPS gateway/OAuth readiness and the owner-authorized record cutover; these variables do not authorize a DNS write.
