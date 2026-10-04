# Outbound target-agent deployment hardening — 2026-10-03

## Scope

This ADR hardens deployment of the signed outbound target-agent transport already shipped on canonical `main`.

It does not change the wire protocol, gateway routing, OAuth model, public tool surface, or Ed25519 signature format.

## Primary sources checked

Checked 2026-10-03:

- OpenAI Security & Privacy:
  https://developers.openai.com/plugins/guides/security-privacy
- OpenAI Remote MCP review requirements:
  https://developers.openai.com/plugins/deploy/app-review
- OpenAI MCP server guidance:
  https://developers.openai.com/plugins/build/mcp-server
- systemd service sandboxing documentation:
  https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html

## Security findings

The canonical outbound agent already keeps the Ed25519 private key on the target and sends only signed outbound HTTPS requests. The remaining deployment gaps were operational:

- `agent.mjs` accepted a symlink/private-key file readable by group/world;
- the target identity was documented with manual OpenSSL commands but had no fail-closed local provisioner;
- the agent had no dedicated persistent non-root user service / immutable release installer;
- operator config needed an explicit mode-0600 lifecycle separate from the gateway service.

## Decision

### Target identity

- Generate the Ed25519 private key on the target.
- Never print the private key.
- Refuse to overwrite an existing key.
- Private-key parent directory is mode 0700; key is mode 0600.
- Emit only the opaque target ID and public-key gateway config.
- Runtime rejects symlink keys and any private-key file with group/world permission bits.
- Outbound agents require an explicit `zt_...` target ID; the legacy reserved `local` ID is not valid for universal routing.

### Persistent service

Install the target agent as a user-level systemd service, not root:

- immutable release directory pinned to the Git SHA;
- release contents are exported from that exact tracked Git commit; mutable/untracked worktree files such as `.env` or local credentials are never copied into the release;
- separate `~/.config/zssh/agent.env` mode 0600;
- config is parsed as data and never shell-sourced;
- production gateway must be an HTTPS origin without credentials/query/fragment/path;
- `ZSSH_PLUGIN_PROFILE=public` and `ZSSH_EXEC_MODE=disabled` are pinned in target-agent config;
- explicit `ZSSH_PUBLIC_ALLOWED_ROOTS` remains mandatory;
- user service applies `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=full`, kernel/control-group protections, `RestrictSUIDSGID`, and restrictive umask;
- `Restart=always` provides bounded recovery after transient transport/process failures.

## OpenAI/review implications

This hardening reduces secret exposure and blast radius without changing the public MCP contract:

- no new plugin tools;
- no new OAuth scopes;
- no target credentials in plugin artifacts or MCP results;
- no inbound target listener;
- target private key stays outside gateway storage.

The next release gate is a real end-to-end deployed universal-gateway + target-agent fixture, followed by production OAuth/reviewer setup and portal verification.
