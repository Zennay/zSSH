# Public ingress address classification hardening — 2026-10-04

## Primary sources

- IANA IPv6 Special-Purpose Address Space: https://www.iana.org/assignments/iana-ipv6-special-registry
  - `::/128`, `::1/128`, and `::ffff:0:0/96` are not globally reachable.
  - IPv4-mapped IPv6 addresses are reserved-by-protocol and must not be accepted as proof of a directly public production ingress address.
- RFC 4291, IP Version 6 Addressing Architecture: https://www.rfc-editor.org/rfc/rfc4291.html
  - IPv4-compatible IPv6 addresses are deprecated.
  - IPv4-mapped IPv6 addresses use the `::ffff:0:0/96` format to represent IPv4 nodes.

## Engineering decision

The public-ingress preflight is a release boundary, not a generic IP parser. It therefore fails closed for IPv6 values beginning with `::`, which covers unspecified/loopback, deprecated IPv4-compatible encodings, and IPv4-mapped encodings including hexadecimal forms such as `::ffff:7f00:1`.

This closes a representation gap in the first external-ingress proof: the previous guard rejected dotted IPv4-mapped loopback such as `::ffff:127.0.0.1`, but a semantically equivalent hexadecimal mapped form could reach the generic IPv6 success path.

The change intentionally does not broaden production reachability. Normal globally routed IPv6 addresses such as `2606:4700:4700::1111` remain accepted.
