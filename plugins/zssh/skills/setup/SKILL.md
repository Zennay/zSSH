---
name: setup
description: Link a Linux VPS to zSSH with one install command, then operate the user's linked servers safely. Use when the user wants to connect, add, list, rename or remove a server, or check their zSSH plan.
---

# Set up and use zSSH

zSSH lets you operate the user's own Linux servers. The plugin already contains
the connection to the hosted zSSH gateway: the user never pastes an MCP URL,
SSH key, password or API token. Signing in happens through the plugin's normal
account connection (OAuth).

## Link a server (one command)

1. Make sure the plugin is signed in. If a tool answers that authentication is
   required, ask the user to connect/sign in to zSSH first.
2. Call `get_server_install_command`. Show the returned `install_command`
   exactly, in one copyable code block, and say:
   "Run this once on your VPS as root (or with sudo). It expires in 15 minutes
   and works only once." Never alter the command or reuse an old one.
3. The user runs it. The installer creates an unprivileged `zssh` user and an
   outbound-only agent (no inbound ports), and the server is **linked to this
   account automatically**. The terminal ends with `ZSSH_LINKED name=...`.
4. Call `list_servers` and confirm the server appears with `online: true`.
   Then run `zssh_server_info` (with `target` if several servers are linked)
   to show the user it works.

If the server shows as pending instead (the gateway requires a second
confirmation), call `get_server_enrollment_status`, ask the user to compare the
fingerprint with the `ZSSH_TARGET_FINGERPRINT` line in their terminal, and only
when they match call `approve_server_enrollment`.

If the command expired, simply get a new one. If the user already ran it, do
not ask them to run it again: refresh `list_servers` first.

## Working on servers

- With one linked server, tools use it automatically. With several, pass
  `target` (the server name or `zt_` id from `list_servers`). Ask the user
  which server when it is ambiguous.
- Prefer read-only inspection first (`zssh_server_info`, `get_disk_usage`,
  `get_memory_usage`, `zssh_read_file`).
- `zssh_exec` (when available) runs bash as the unprivileged `zssh` user. It
  only works if the server was linked with shell access. Explain anything
  destructive or hard to undo before running it, and never claim a command
  ran without a tool result.
- Never ask for or print passwords, private keys, tokens or full `.env` files.

## Managing the account

- `rename_server` gives a server a friendlier name.
- `revoke_enrolled_server` disconnects a server immediately.
- `get_account` shows the plan, server and daily action limits and returns a
  personal `manage_url` (valid one hour) for upgrading or managing billing.
  Share it only with this user. When a tool reports a plan limit, offer this.

## Legacy private setup

When `get_server_install_command` is absent, this is a private self-hosted
zSSH gateway, not the hosted service. It may expose `get_pairing_status` with
a separate local approval instead. Do not try to enroll a private endpoint
with a one-time command.
