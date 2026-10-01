# zSSH Privacy Policy

Last updated: 2026-10-01

zSSH is a self-hosted remote-operations MCP project for Linux targets. This policy describes the data handled by the zSSH software and the public ChatGPT plugin integration under development.

## Data zSSH processes

zSSH may process only the data needed for a requested tool action, including:

- command or tool inputs explicitly sent to the connected zSSH server;
- in the public plugin, non-secret text file paths and contents explicitly read from or written to the dedicated public roots configured by the server operator;
- in private owner-operated mode, file paths and contents explicitly requested within the operator's broader configured roots;
- Linux system information returned by narrowly scoped inspection tools;
- authentication material used to authorize the connection; and
- local audit records containing action type, outcome, bounded execution metadata, paths, and redacted command information.

zSSH is designed not to request passwords, private keys, API keys, MFA/OTP codes, or other authentication secrets as tool inputs. The public plugin additionally refuses common credential-file paths and rejects file content that appears to contain authentication secrets; it does not rely on redaction as permission to expose those files. Private owner-operated mode retains redaction as a defense-in-depth control.

## Purpose

Data is processed only to authenticate the connection, execute the user-requested operation on the connected Linux target, return the result, enforce safety policy, and maintain a local security audit trail.

## Where data goes

The current zSSH architecture is self-hosted. The zSSH software does not require a zSSH-operated cloud backend for command execution or file access. Tool traffic is exchanged between the user's MCP client and the zSSH server selected by the user or administrator.

When zSSH is used from ChatGPT or another MCP client, that client provider separately processes data under its own terms and privacy policy.

## Retention

Tool results are returned to the calling client and are not stored by zSSH as a separate conversation history. The server writes a local JSONL audit log on the target host. The operator controls the host, audit-log retention, backups, and deletion.

A future hosted zSSH service, if introduced, must publish updated retention details before processing user data.

## User controls

The server operator can:

- stop or uninstall zSSH;
- revoke or rotate connection credentials;
- restrict accessible filesystem roots;
- configure a separate, narrow `ZSSH_PUBLIC_ALLOWED_ROOTS` set for the public plugin;
- keep raw shell disabled;
- select the public plugin profile, which does not expose generic command execution;
- configure or remove local audit logs subject to their own operational requirements.

## Security

zSSH binds to loopback by default, refuses root execution unless explicitly overridden, constrains file access to configured roots, caps output and file sizes, applies command timeouts, and keeps raw shell disabled by default.

## Contact

For privacy questions or requests, open a private security report where appropriate or use the support route documented in [SUPPORT.md](./SUPPORT.md).

This policy will be updated before public directory submission if the production authentication, hosting, or data-flow model changes.
