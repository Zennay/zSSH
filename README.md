# zSSH

zSSH is a self-hosted, security-first MCP gateway for Linux targets. Install it on the Linux machine you want ChatGPT or another MCP client to operate. The runtime, filesystem access, service access, credentials, and audit log stay on that target.

zCloud is an optional integration. It is not required to run zSSH.

## What runs where

```text
ChatGPT / MCP client
        |
        | HTTPS + revocable zSSH client token
        v
+----------------------------------+
| User's own Linux server / VPS    |
|                                  |
|  zSSH MCP service                |
|  - auth + policy                 |
|  - allowed filesystem roots      |
|  - explicit Git tools            |
|  - allowlisted systemd services  |
|  - local audit log               |
+----------------------------------+
```

The normal self-hosted path has no Zennay-operated relay, VPS, command queue, credential store, or execution backend. A user may choose their own reverse proxy, domain, VPN, or supported tunnel in front of the loopback-only service.

zSSH does not need to SSH back into the machine it controls. It is already running on that machine as an unprivileged Linux user.

## Current release direction

Version 0.2 introduces the self-hosted product model:

- provider-agnostic Linux installation;
- one stable target identity per installation;
- revocable client tokens stored as hashes on the target;
- a local `zssh` CLI for connection-token lifecycle;
- a bounded `plugin` profile for ChatGPT-style integrations;
- the existing `private` profile for trusted owner-operated use;
- filesystem root boundaries, output limits, timeouts, redaction, and JSONL audit logs;
- backwards compatibility for the existing zCloud/VPS deployment.

One zSSH installation currently represents one Linux target.

## Profiles

### `plugin` profile

New installs default to `ZSSH_PROFILE=plugin`. This profile deliberately does **not** advertise the generic raw-shell, generic safe-runner, or arbitrary file-write tools.

It exposes focused operations:

- `zssh_get_profile`
- `zssh_server_info`
- `zssh_list_directory`
- `zssh_read_file`
- `zssh_git_status`
- `zssh_git_pull` using `--ff-only`
- `zssh_service_status` for allowlisted user services
- `zssh_restart_service` for allowlisted user services

Filesystem tools remain constrained by `ZSSH_ALLOWED_ROOTS`. Service tools remain constrained by `ZSSH_ALLOWED_SERVICES`.

### `private` profile

Existing installations default to `private` during migration so their current behavior does not silently change.

Private profile additionally exposes:

- `zssh_write_file`
- `zssh_run_safe`
- `zssh_exec`

`zssh_exec` still refuses execution unless the operator explicitly sets `ZSSH_EXEC_MODE=full`.

## Install on a Linux target

Requires Node.js 20+, npm, Git, and user-level systemd.

Run as the dedicated unprivileged target user, never as root:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/bootstrap-linux.sh | bash
```

A new install:

1. clones the canonical repository;
2. validates and installs an immutable release;
3. creates a user-level `zssh.service`;
4. creates a stable target ID;
5. defaults to the bounded `plugin` profile;
6. creates a local revocable ChatGPT client token;
7. runs the matching MCP canary;
8. prints the connection token once.

If `ZSSH_PUBLIC_URL` is already configured, the installer prints a ready-to-paste MCP capability URL instead of only the token.

Example with explicit target configuration:

```bash
ZSSH_TARGET_NAME=prod-eu-1 \
ZSSH_PUBLIC_URL=https://server.example.com \
ZSSH_ALLOWED_ROOTS=/srv/my-app \
ZSSH_ALLOWED_SERVICES=my-app.service,worker.service \
bash <(curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/bootstrap-linux.sh)
```

Do not add `/mcp` to `ZSSH_PUBLIC_URL`; the CLI appends the MCP path.

## Connect ChatGPT or another MCP client

zSSH client tokens are independent, revocable credentials. The plaintext token is shown only when it is created; the server stores only its SHA-256 hash.

Create a new connection:

```bash
zssh connect chatgpt
```

With `ZSSH_PUBLIC_URL=https://server.example.com`, output includes a URL shaped like:

```text
https://server.example.com/mcp/zssh_<client-id>_<secret>
```

Treat the full URL as a credential.

List active client identities without revealing secrets:

```bash
zssh token list
```

Revoke one connection:

```bash
zssh token revoke <client-id>
```

A revoked token stops authenticating immediately; other client tokens remain valid.

Legacy capability URLs, `x-zssh-key`, and bearer authentication remain supported so existing installations do not break.

## HTTPS exposure

The zSSH Node service binds to `127.0.0.1` by default. Do not expose port 8788 directly to the internet.

For a directly reachable self-hosted endpoint, terminate HTTPS in a reverse proxy such as Caddy and forward to `127.0.0.1:8788`. See `deploy/Caddyfile.example`.

For private development, a supported MCP tunnel can be used instead. A tunnel is optional and does not change the execution model: commands still execute on the user's target.

## ChatGPT plugin status

The self-hosted MCP side is designed so each user can install zSSH on their own Linux target and connect directly to it.

OpenAI's public Plugin Directory currently expects a stable public MCP endpoint for a submitted plugin. Template MCP URLs, where each customer supplies a different managed endpoint, are currently limited to trusted developers with an established relationship. That platform constraint means a single public directory listing cannot yet universally discover arbitrary user-owned zSSH domains without either template-URL access or a central routing service.

zSSH intentionally does **not** add a central command relay just to work around that constraint. The direct self-hosted architecture remains the source of truth.

The `plugin` profile exists so the tool surface is already bounded and review-oriented while the distribution path evolves.

Useful OpenAI references:

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/plugins/build/auth

## Target identity

Each installation has:

- `ZSSH_TARGET_ID`: stable opaque identity for the target;
- `ZSSH_TARGET_NAME`: human-readable label.

The `zssh_get_profile` tool is marked with `_meta["openai/profile"]: true` and returns the stable target identity so clients can distinguish connected servers.

## Policy boundaries

### Filesystem

`ZSSH_ALLOWED_ROOTS` is a comma-separated set of roots that file and repository tools may access. Real paths are checked before operations to prevent simple path traversal and symlink escapes.

### Services

`ZSSH_ALLOWED_SERVICES` is a comma-separated allowlist of user-level systemd unit names. Empty means no service can be inspected or restarted through the service tools.

Service operations use `systemctl --user`; plugin mode does not provide a generic system-service command surface.

### Git

Plugin mode provides explicit Git operations rather than arbitrary Git arguments:

- status is read-only;
- pull is fixed to `git pull --ff-only`.

### Raw shell

Raw shell belongs only to private profile. Even there, it is disabled unless `ZSSH_EXEC_MODE=full` is explicitly configured.

## Credentials and storage

Default target-local files:

```text
~/.config/zssh/gateway.env     runtime configuration + legacy credentials
~/.config/zssh/clients.json    hashes + labels of revocable client tokens
~/.local/state/zssh/audit.jsonl
~/.local/share/zssh/current    active immutable release symlink
~/.local/bin/zssh              local management CLI
```

`clients.json` is mode 0600. Raw revocable client tokens are not persisted there.

## Backwards compatibility

The existing working VPS path is intentionally preserved:

- existing `gateway.env` is not regenerated;
- old installs that lack `ZSSH_PROFILE` are migrated to `private`;
- if a fresh legacy host already has `~/zennay-cloud`, that path remains the default allowed root;
- `deploy/bootstrap-vps.sh` remains available;
- legacy static capability/API/bearer credentials remain accepted;
- zCloud-specific operational helpers remain optional files under `ops/`.

## Local development

```bash
git clone https://github.com/Zennay/zSSH.git
cd zSSH
npm install
cp .env.example .env
npm test
npm start
```

Available canaries:

- `node live-canary.mjs` — private fail-closed profile proof;
- `node plugin-canary.mjs` — bounded plugin profile proof;
- `npm run mcp:claude-canary` — remote MCP compatibility proof.

## Claude compatibility

zSSH uses MCP Streamable HTTP. Claude Code and other clients that can set an authorization header may connect to `/mcp` with a bearer token. Hosted clients that support a URL-only/no-sign-in model can use a revocable zSSH capability URL.

`mcp-claude-canary.mjs` understands both private and plugin profiles and accepts revocable client tokens through `ZSSH_MCP_CLIENT_TOKEN`.

## Security model

zSSH is intentionally an infrastructure-control component. Install it only on targets where you understand the permissions of the Linux user running the service.

The service refuses root startup by default. Filesystem, service, and command policy are enforced server-side; model instructions are never treated as the authorization boundary.

See `SECURITY.md` for the threat model and `PRIVACY.md` for the default self-hosted data-flow statement.

## Canonical project docs

- Project HQ: https://app.notion.com/p/3e89e19ac955811a9008d420e3e2a634
- Handoff: https://app.notion.com/p/3e89e19ac95581639bdcdc9daeb37ae8

## Repository history

The original bootstrap lived temporarily under `Zennay/zCloud/zssh/`. The standalone `Zennay/zSSH` repository is authoritative. Historical HaxLab transport artifacts remain only under `ops/archive/` for traceability.
