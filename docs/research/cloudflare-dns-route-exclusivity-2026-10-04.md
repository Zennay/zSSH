# Cloudflare DNS route exclusivity — 2026-10-04

## Scope

This note covers the production DNS invariant for `zssh.cheapgpt.shop` during M5 public-plugin submission.

## Primary sources

- Cloudflare DNS record types (updated 2026-06-02): https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/
- Cloudflare DNS records (updated 2026-08-14): https://developers.cloudflare.com/dns/manage-dns-records/
- Cloudflare DNS Records API: https://developers.cloudflare.com/api/resources/dns/subresources/records/

## Current platform facts

Cloudflare documents A and AAAA records as IP-address resolution records: A maps a hostname to IPv4 and AAAA maps it to IPv6. It also documents CNAME as mapping a hostname to another canonical hostname. Cloudflare's DNS record-type reference states that SVCB and HTTPS records can give clients connection information up front, and that manually configured HTTPS records are served for DNS-only names when the same-name records are DNS-only.

## zSSH production invariant

The M5 public hostname is intentionally a single DNS-only IPv4 route:

- hostname: `zssh.cheapgpt.shop`
- type: `A`
- address: `198.244.191.182`
- proxied: `false`

A second same-name routing mechanism can make the effective client path differ from that reviewed target even when the desired A record itself is correct. In particular, a same-name AAAA record can create an IPv6 route and HTTPS/SVCB can alter service connection behavior.

## Decision

The guarded Cloudflare publisher must fail closed before mutation if the exact production hostname already contains any of these routing/delegation record types:

- `AAAA`
- `CNAME`
- `HTTPS`
- `NS`
- `SVCB`

Multiple A records remain rejected as before. Non-routing proof/metadata records such as TXT remain allowed to coexist.

The publisher does not automatically delete or rewrite conflicting records. Removing a pre-existing conflicting route is an explicit operator/provider action, after which the guarded publisher can be rerun.

## Verification

Regression coverage must prove:

1. each alternate routing type above is rejected before mutation;
2. multi-A RRsets remain rejected;
3. harmless coexisting TXT records remain preserved;
4. error output does not include the Cloudflare API token.
