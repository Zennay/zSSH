---
name: setup
description: Connect a Linux VPS to zSSH using a one-time personal install command, with no separate Auth0 login and a persistent secure agent.
---

# Connect a VPS to zSSH

The intended experience is **one install command**. Do not ask the user for an IP, SSH password, SSH private key, Auth0 login or manually copied API token.

## Preconditions

This setup skill applies only to a *published* zSSH no-login plugin whose MCP URL is the dedicated verified-ChatGPT mTLS endpoint, and which offers `get_server_install_command`. A successful connection to an older private zSSH service or to the OAuth-only gateway is not proof that this variant was deployed. Never claim success before calling the real plugin tools.

## One-command onboarding

1. Call `get_server_install_command` exactly once when the user asks to connect a new VPS. The response contains a complete pinned installer command and its expiration. Copy the complete returned command unchanged; never invent an `enr_...` code or use example placeholders.
2. Explain that the user must run this command on their own Ubuntu/Debian VPS terminal with sudo privileges. The command contains a private **single-use, 15-minute** code; do not post it in chats, source control, logs or screenshots.
3. The installer creates the host-local Ed25519 identity, signs the claim and installs the outbound agent as a persistent systemd user service. The code is consumed at first registration and is **not needed again**; the host key remains valid until revoked.
4. Call `get_server_enrollment_status` to confirm the exact enrolled target appears. If a claim is pending due to an older compatibility mode, use `approve_server_enrollment` only when the owner has explicitly confirmed the exact matching fingerprint; never approve a stranger's fingerprint.
5. If the target is connected, call `get_system_uptime` to verify read-only functionality. If offline, report the state rather than issuing another code unnecessarily.

## Ongoing use and removal

The agent initiates all connections outward over HTTPS and reconnects after a reboot; the 15-minute onboarding code is **never a recurring login**. `revoke_enrolled_server` permanently removes that server's authorization, but does not delete data on the VPS. Multiple servers require explicit selection when supported; do not silently operate on the wrong server.

This no-login mode must fail closed when a trusted ChatGPT client identity is unavailable. The platform's anonymous `openai/subject` is an identifier, not a cryptographic ownership credential on its own. Never bypass server-side restrictions or offer arbitrary remote shell as a workaround. The public plugin exposes only reviewed scoped tools.

If this version has not been deployed to the verified ChatGPT mTLS hostname, say that plainly. Do not substitute the ordinary OAuth URL `https://zssh.zennay.nl/mcp` as though it were the login-free version.
