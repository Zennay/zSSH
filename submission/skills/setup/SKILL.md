---
name: setup
description: Connect zSSH to a Linux VPS with one account-bound install command, confirm its key fingerprint, and manage paired servers.
---

# Set up zSSH in ChatGPT

A public zSSH plugin uses **one shared HTTPS MCP gateway**, not one URL per VPS.
End users should never configure their own DNS, reverse proxy, HTTPS certificate, SSH key,
or public inbound port. Login happens using the plugin's standard OAuth account connection.

## Personal one-command onboarding

1. Confirm the zSSH public plugin is connected and signed in. An installed but
   unpublished or unauthenticated plugin cannot enroll a VPS.
2. Invoke `get_server_install_command` to get one personal, 15-minute, single-use
   Linux command. Show the exact returned `install_command` in a copyable code block
   or the connection card. **Never change the gateway or SHA, reuse another user's
   command, or publish the enrollment code.**
3. The owner pastes that command into the terminal of the Linux machine they
   control. The installer uses apt to create the unprivileged `zssh` service
   account, downloads the exact reviewed Git revision, and installs only an
   **outbound** TLS agent; it does not open SSH or MCP ports or replace private
   local zSSH gateways. No reusable API key or private key is sent to ChatGPT.
4. The VPS prints `ZSSH_TARGET_FINGERPRINT SHA256:...` and a `zt_...` target
   ID. Invoke `get_server_enrollment_status`. Ask the owner to compare the
   displayed fingerprint against their **actual VPS terminal**. Approval must
   be explicit; never silently approve because a gateway says "pending".
5. Only when both values match, call `approve_server_enrollment` with that
   exact target and fingerprint. The installed agent will establish an outbound
   connection. Use `get_server_enrollment_status` again, then a read-only
   `zssh_server_info` or `get_system_uptime` to confirm the intended VPS.
6. To disconnect a machine, call `revoke_enrolled_server` with the target ID.
   Multiple-server target selection is not yet available; do not imply more
   than one simultaneously enrolled server can be controlled.

If the owner already ran the command and the plugin shows pending, **do not run
the installer again**: refresh enrollment status, compare the fingerprints, and
approve once. If the command expired before redemption, generate a new one.
If a previously cloned VPS has conflicting agent identity files, installation
stops rather than overwriting keys or silently redirecting to another target.

## Legacy private setup

When `get_server_install_command` is absent, this is not the new public
onboarding service. The existing private zSSH deployment may still expose
`get_pairing_status`, a separate local pairing approval, or a capability URL.
Do not try to enroll those private endpoints using a public one-time command.
No ChatGPT plugin can remotely alter a registered MCP base URL by writing to
the target machine: the hosted gateway origin must actually be online.

## Availability and safety

The public enrollment tools require the production gateway with
`ZSSH_ENROLLMENT_ENABLED=1`, a pinned `ZSSH_INSTALLER_REF`, OAuth resource
server validation, and production DNS/TLS. An offline or unreviewed deployment
cannot be declared ready just because this UI and installer exist in the repo.
Never ask for passwords, private keys, reusable API tokens, raw personal
enrollment commands, or a user's SSH credentials in chat.
