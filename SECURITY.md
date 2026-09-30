# zSSH Security

## Security model

zSSH is a self-hosted MCP gateway that executes operations on the same Linux target on which it runs. It should be treated as privileged infrastructure software even when it runs as an unprivileged user.

The security boundary is enforced by the zSSH process and the operating system, not by model instructions.

## Default protections

- The service refuses to start as root unless explicitly overridden.
- The Node service binds to loopback by default.
- New installations use the bounded `plugin` profile.
- Raw shell is omitted from plugin profile.
- Raw shell is disabled by default even in private profile.
- File access is restricted to configured real-path roots.
- User-level systemd service operations require an explicit service allowlist.
- Git mutation is exposed as a fixed `pull --ff-only` operation rather than arbitrary arguments.
- Commands have time and output limits.
- Secret-like output is redacted.
- Operations are recorded in a local JSONL audit trail.
- Revocable client tokens are stored only as SHA-256 hashes.

## Client tokens

A token created by `zssh connect` or `zssh token create` is a bearer credential. Anyone who has it may use the permissions exposed by that target's active zSSH profile.

Treat both the raw token and a capability URL containing the token as secrets.

Use `zssh token revoke <id>` if a token may have been exposed.

Legacy static credentials remain supported for compatibility. Operators should prefer revocable client tokens for new connections.

## Network exposure

Do not expose the loopback Node port directly. Terminate HTTPS in a reverse proxy or use a supported private tunnel.

When a reverse proxy is used, its TLS, routing, access logs, and network policy become part of the deployment's security boundary.

## Private profile

Private profile is intentionally more powerful. Enabling `ZSSH_EXEC_MODE=full` can permit arbitrary commands with the permissions of the zSSH Linux user and any sudo/capabilities granted to that user.

Use full shell only on a target you explicitly intend to control that way.

## Reporting

Do not include real capability URLs, client tokens, API keys, bearer tokens, private keys, or passwords in bug reports.
