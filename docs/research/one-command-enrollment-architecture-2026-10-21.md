# OAuth-bound one-command enrollment: implementation boundary

This document accompanies `enrollment-store.mjs`, the first implemented component of [issue #382](https://github.com/Zennay/zSSH/issues/382).

## Intended user experience

1. Install zSSH in ChatGPT and authenticate to the hosted zSSH gateway **once**.
2. Ask the plugin to add a Linux server. The gateway issues a 256-bit, single-use code with a 15-minute expiry, bound to the authenticated OAuth profile.
3. Copy the resulting **one-command install** to an authorized VPS. The installer sets up an unprivileged service account and outbound TLS agent, keeps its Ed25519 private key on that VPS, and submits a key-ownership claim.
4. The plugin shows the target public-key fingerprint for explicit approval. Approving the exact fingerprint activates it for **that OAuth profile only**; other users cannot route operations to it.
5. The plugin can then issue scoped operations, inspect availability, list targets, and revoke access. Removing a target must disconnect its live session.

## Implemented in this change

`EnrollmentStore` has durable atomically replaced owner-only local JSON state (0600, directory 0700), single-process serialized mutations, exact validation of OAuth-derived profile IDs and opaque target IDs, 256-bit random one-time codes stored as SHA-256 hashes, expiry and outstanding-request limits, Ed25519 proof-of-private-key possession, single-consumption claims, target fingerprint matching before approval, per-profile target listing, and revocation.

Expected host signature over UTF-8 text:

```text
zssh-enrollment-v1
<opaque zt_ target id>
<SHA256 hex of one-time enrollment code>
<unique nonce_ string>
```

The host must use Ed25519, submit the public SPKI PEM, and never send the private key. Code possession alone is not a connected or approved target.

## Staged integration (2026-10-21)

The OAuth-scoped plugin tools are now implemented behind explicit `ZSSH_ENROLLMENT_ENABLED=1`: `get_server_install_command` generates the complete account-specific single-command installer (personal code included); `get_server_enrollment_status` lists pending/approved targets; `approve_server_enrollment` confirms the signed Ed25519 fingerprint; `revoke_enrolled_server` removes live authority. The installer accepts `--enroll`, `--gateway`, and a pinned `--ref`, generates its own private identity locally, POSTs a bounded signed claim to `/enrollment/v1/claim`, and provisions an outbound agent. Dynamic signed agent verification, per-profile single-target routing, and revocation are implemented under the same feature flag. The private existing gateway is unchanged.

**Not live yet:** Public DNS, TLS origin, production OAuth, host/portal attestations, the production enrollment gateway deployment profile, durable multi-instance token/route storage, and multi-target selection are not completed. The OAuth+enrollment flag also requires `ZSSH_INSTALLER_REF` set to a full reviewed Git commit and forbids mixing new dynamic enrollment with a static agent trust configuration. A gateway must complete issue #159 before public use. The module and green local health on a VPS are not proof of a live ChatGPT connection.

**Do not** auto-approve claims, place permanent credentials in CLI arguments or logs, hand private keys to a gateway, expose the private loopback gateway, or conflate an active health endpoint with a ChatGPT connection.

## Deployment notes

- Each gateway process currently serializes mutations in-memory; scale-out requires a transactional durable store with cross-process conflict handling.
- The existing private installed zSSH service and legacy pairing registry stay unchanged.
- Reconcile revocation with live target sessions before exposing enrollment to users.
