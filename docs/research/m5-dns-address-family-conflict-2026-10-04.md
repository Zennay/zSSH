# M5 DNS address-family conflict hardening — 2026-10-04

## Context

The production zSSH public origin is currently configured as an IPv4-only DNS publication target (`ZSSH_PUBLIC_IPV4=198.244.191.182`). The guarded Cloudflare publisher owns the exact DNS-only A record for the public hostname.

Cloudflare documents that A and AAAA records map the same DNS name to IPv4 and IPv6 addresses respectively:
- https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/
- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/

Cloudflare also notes that client software determines whether IPv4 or IPv6 is used when both are available:
- https://developers.cloudflare.com/network/ipv6-compatibility/

The same Cloudflare record-type reference documents HTTPS/SVCB records as service-binding records that can tell clients how to connect before the HTTP exchange. For DNS-only names, manually configured HTTPS records can be served alongside same-name DNS-only address records.

## Risk

Before this change, the guarded publisher rejected exact-name CNAME/NS conflicts and multiple A records, and the first hardening pass added AAAA. A remaining gap was exact-name HTTPS/SVCB records: those records can alter connection behavior independently of the guarded A record. Because zSSH's M5 contract intentionally binds one DNS-only IPv4 route to one reviewed VPS, any alternate address or service-binding route would make DNS/TLS/ingress evidence ambiguous and could steer reviewer traffic outside the intended release target.

## Decision

For the current IPv4-only M5 publication lane, exact-name `AAAA`, `CNAME`, `HTTPS`, `NS`, and `SVCB` records are fail-closed routing/delegation conflicts. The publisher refuses mutation and requires the operator to resolve them explicitly.

This does not delete or alter an existing conflicting record automatically. Future intentional dual-stack or service-binding support must add an explicit desired route plus validation/evidence before relaxing this invariant.

## Scope

- validation only before DNS mutation;
- no credential, OAuth, MCP tool, target permission, or public endpoint expansion;
- TXT and other unrelated coexisting records remain preserved;
- regression coverage verifies AAAA, CNAME, HTTPS, NS, and SVCB conflicts are rejected.
