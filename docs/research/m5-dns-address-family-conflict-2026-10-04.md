# M5 DNS address-family conflict hardening — 2026-10-04

## Context

The production zSSH public origin is currently configured as an IPv4-only DNS publication target (`ZSSH_PUBLIC_IPV4=198.244.191.182`). The guarded Cloudflare publisher owns the exact DNS-only A record for the public hostname.

Cloudflare documents that A and AAAA records map the same DNS name to IPv4 and IPv6 addresses respectively:
- https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/
- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/

Cloudflare also notes that client software determines whether IPv4 or IPv6 is used when both are available:
- https://developers.cloudflare.com/network/ipv6-compatibility/

## Risk

Before this change, the guarded publisher rejected exact-name CNAME and NS conflicts and multiple A records, but it allowed an unrelated AAAA record to coexist. Because zSSH has no configured or verified production IPv6 origin, leaving an existing AAAA record in place could make IPv6-capable clients reach a different host than the guarded IPv4 target. That would make DNS/TLS/ingress evidence ambiguous and could route part of reviewer traffic outside the intended release target.

## Decision

For the current IPv4-only M5 publication lane, an exact-name AAAA record is a fail-closed conflict, like CNAME/NS. The publisher refuses mutation and requires the operator to resolve the IPv6 record explicitly.

This does not delete or alter an existing AAAA record automatically. Future intentional dual-stack support must add an explicit desired IPv6 address plus validation/evidence before relaxing this invariant.

## Scope

- validation only before DNS mutation;
- no credential, OAuth, MCP tool, target permission, or public endpoint expansion;
- TXT and other unrelated coexisting records remain preserved;
- regression coverage verifies the AAAA conflict is rejected.
