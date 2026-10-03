# Scoped sudo service grants — 2026-10-03

## Primary sources reviewed

- sudoers(5): https://man7.org/linux/man-pages/man5/sudoers.5.html
- OpenAI Security & Privacy: https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Define tools: https://developers.openai.com/plugins/plan/tools
- OpenAI Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines

## Security findings

The current sudoers documentation warns that command-argument wildcards can match whitespace and cross argument boundaries, and recommends doing non-trivial command-line processing outside sudoers rather than relying on broad wildcard matching.

OpenAI's current plugin guidance requires least privilege, server-side authorization/input validation, accurate write/destructive annotations, and confirmation/friction for consequential actions. Tool annotations do not replace the server-side permission boundary.

## Engineering decision

Do not grant zSSH direct `sudo systemctl ...`, wildcard sudoers commands, shells, editors, package managers, or arbitrary root command execution.

Instead:

1. Install one root-owned helper at `/usr/local/libexec/zssh-sudo`.
2. Store the exact allowed systemd service names in a root-owned `/etc/zssh/sudo-services` file.
3. Grant the dedicated zSSH service user passwordless sudo for the helper path only.
4. The helper accepts only fixed operations and validates service identifiers before invoking an absolute `/usr/bin/systemctl` path without a shell.
5. The MCP server exposes the root mutation only in the private profile. Public OpenAI profile tools remain unchanged.
6. The service-restart tool is marked as a write and destructive operation so clients can apply confirmation friction.
7. Updating the root-owned service allowlist remains an explicit owner/admin action; the zSSH service account cannot broaden its own sudo capabilities.

This creates a two-layer authorization boundary: MCP tool/input validation plus a root-owned helper/config enforced independently by sudo.
