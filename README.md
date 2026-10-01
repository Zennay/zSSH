# zSSH

zSSH is a **standalone security-first remote operations project**. zCloud is its control-plane/dashboard integration, not its parent project.

## Current milestone

**Public plugin candidate — review hardening.** The safe execution foundation, public OAuth resource-server profile, local target pairing/revocation, and machine-validated submission package are implemented. Remaining work is concentrated in production OAuth/reviewer setup, the public endpoint model, and final OpenAI portal validation.

This branch proves the smallest safe foundation:

- remote MCP endpoint at `/mcp`;
- no-sign-in capability URLs for hosted MCP clients, optional static `x-zssh-key` auth, plus bearer authentication for CLI clients;
- `zssh_server_info`, `zssh_run_safe`, `zssh_exec`, `zssh_read_file`, and `zssh_write_file`;
- non-root startup guard;
- command timeout and output limits;
- configured filesystem roots;
- secret redaction in tool output and audit data;
- JSONL audit trail;
- raw shell disabled by default; command classification is audit/UX metadata, not the security boundary;
- Node unit tests for classification, redaction, and path boundaries.

## Project ownership

**Canonical source:** `Zennay/zSSH`.

zSSH has its own mission, roadmap, handoff, release lifecycle, security gates, and project identity. It is not a zCloud or HaxLab subproject.

zCloud only:
- registers zSSH as a first-class project in `projects.json`;
- displays its status/progress;
- may provide shared portfolio/control-plane infrastructure where useful.

HaxLab has no zSSH source or deployment responsibility.

## Architecture direction

```
ChatGPT plugin
    |
    v
zSSH remote MCP gateway
    |
    v
pairing / auth / policy
    |
    v
paired target agent
    |
    +-- Linux user
    +-- scoped sudo
    +-- files / systemd / git
```

M0 runs the gateway and execution adapter together to keep the proof small. M2 splits the target agent boundary and adds pairing/revocation. Production must not depend on storing users' SSH private keys in the gateway.

## Local development

Requires Node 20+.

```bash
git clone https://github.com/Zennay/zSSH.git
cd zSSH
npm install
cp .env.example .env
# export values from .env in your preferred way
npm test
npm start
```

The server binds to `127.0.0.1` by default. Put TLS/reverse proxy or a development tunnel in front of it rather than binding the M0 process directly to the public internet.

`node live-canary.mjs` checks authenticated MCP discovery, non-root execution,
the safe runner, a temporary read/write roundtrip inside the first allowed root,
rejection of an outside-root read, and rejection of raw shell. It deletes its
temporary test directory on exit. The first allowed root must be writable by
the zSSH service user for the file proof. CI runs this against a production-mode
server with an isolated temporary root; a green CI result is not evidence that
the same proof has passed on the OVH runtime.

## Policy

`ZSSH_EXEC_MODE=disabled` is the default for raw shell. Full raw shell remains an explicit trusted/disposable-target mode and command classification is never treated as an authorization boundary.

For normal M1 inspection, `zssh_run_safe` uses a fixed read-only binary allowlist and `spawn(..., { shell: false })`, so user arguments are passed as argv instead of being interpreted by a shell. The default allowlist is `uptime`, `whoami`, `id`, `uname`, `pwd`, `df`, and `free`; operators may reduce it further with `ZSSH_SAFE_PROGRAMS`.

Production hardening still requires a dedicated service account, scoped sudo/capabilities, stronger approval semantics, rate limiting, agent pairing, and review against current hosted-MCP requirements. The private single-owner deployment intentionally avoids a browser OAuth flow. Hosted clients can use a high-entropy capability URL over HTTPS; clients that support custom headers can instead use `x-zssh-key`.

## ChatGPT integration status

OpenAI public review uses a separate fail-closed profile so the existing private operator workflow remains available. The public profile now includes a compact MCP Apps connection card for profile/pairing status; the operational tools continue to work without UI.

### Public plugin review profile

Set `ZSSH_PLUGIN_PROFILE=public` to advertise only a narrow review-oriented tool surface. In this profile:

- `zssh_exec` and `zssh_run_safe` are not exposed to MCP clients;
- read-only system inspection is split into explicit tools such as `get_system_uptime`, `get_disk_usage`, and `get_memory_usage`;
- `ZSSH_EXEC_MODE=full` is rejected at startup;
- all exposed tools carry explicit read-only, destructive, and open-world annotations;
- `OPENAI_APPS_CHALLENGE_TOKEN` can serve the exact plaintext domain-verification token at `/.well-known/openai-apps-challenge`;
- CI runs `public-plugin-canary.mjs` against the real MCP server and fails if generic executors reappear.

Privacy, terms, support, and the current review checklist are in [PRIVACY.md](./PRIVACY.md), [TERMS.md](./TERMS.md), [SUPPORT.md](./SUPPORT.md), and [docs/openai-plugin-review.md](./docs/openai-plugin-review.md).


OpenAI's current plugin documentation uses remote MCP over Streamable HTTP. Public submission requires a stable public HTTPS endpoint, production OAuth, a current tool scan, domain verification, review cases, and reviewer credentials. zSSH already implements the OAuth resource-server boundary and target pairing; the remaining product decision is how a self-hosted per-user target maps to OpenAI's normal universal-endpoint model (template URLs are restricted to trusted developers).

### Public OAuth resource server

Public zSSH now defaults to OAuth resource-server mode. Configure an established OAuth/OIDC provider with:

- `ZSSH_PUBLIC_BASE_URL` — the canonical HTTPS resource identifier;
- `ZSSH_OAUTH_ISSUER` — the exact authorization-server issuer;
- `ZSSH_OAUTH_JWKS_URI` — the provider JWKS endpoint;
- `ZSSH_OAUTH_SCOPES` — defaults to `zssh:read zssh:write`.

The server publishes `/.well-known/oauth-protected-resource`, returns a standards-based `WWW-Authenticate` challenge, verifies JWT signature/issuer/audience/expiry, and enforces read/write scopes at tool level. Public production mode refuses legacy static authentication unless an explicit test-only override is set.

The private/default profile keeps the existing capability URL, API-key, bearer-token, and trusted-loopback workflows unchanged.


### Target pairing and revocation

A valid OAuth token identifies a user, but it does **not** automatically grant access to a Linux target. Public mode requires a second local pairing gate.

After OAuth linking, call `get_pairing_status`. If the profile is not paired, zSSH creates a short-lived request such as `pair_ab12...`. On the target, the owner approves it locally:

```bash
node pairing-cli.mjs approve pair_ab12...
```

The profile can then use the target within its OAuth scopes. To revoke it immediately:

```bash
node pairing-cli.mjs list
node pairing-cli.mjs revoke zssh_<profile-id>
```

The registry stores opaque hashed profile IDs rather than the raw OAuth subject. Pairing is required by default for the public profile and cannot be disabled in production without an explicit unsafe test override.


## Claude MCP compatibility

zSSH exposes the standard Streamable HTTP MCP transport at `/mcp`, so it can be
used by Claude Code and by Claude's MCP connector. Claude Code requires the
remote server to be declared as an HTTP server; a URL without `type: "http"`
is interpreted as a local stdio server and will not connect.

Claude Code setup:

```bash
claude mcp add --transport http zssh "$ZSSH_MCP_URL" \
  --header "Authorization: Bearer $ZSSH_BEARER_TOKEN"
claude mcp get zssh
```

Or copy `deploy/claude-code.example.json` into a Claude MCP configuration and
replace the hostname and token. The equivalent JSON transport name
`streamable-http` is also accepted by Claude Code.

Before adding the server to Claude, verify the endpoint from the client
machine:

```bash
ZSSH_MCP_URL=https://YOUR-ZSSH-DOMAIN.example/mcp \
ZSSH_MCP_TOKEN="$ZSSH_BEARER_TOKEN" \
npm run mcp:claude-canary
```

The endpoint must be reachable over public HTTPS for Claude's hosted MCP
connector; local stdio servers cannot be used by that connector. For a VPS,
put Caddy or another TLS reverse proxy in front of the loopback-only zSSH
service. `deploy/Caddyfile.example` contains the minimal reverse-proxy config.
Do not expose port 8788 directly and do not commit the bearer token.

For Claude's hosted connector, the most compatible private single-owner path
uses **No sign-in** plus a high-entropy capability URL. This avoids the custom
browser OAuth/DCR flow entirely and does not require Claude to support arbitrary
request headers:

```text
Authentication: No sign-in
MCP URL: https://YOUR-ZSSH-DOMAIN.example/mcp/<ZSSH_MCP_CAPABILITY_TOKEN>
```

Treat the entire capability URL as a credential: do not paste it into tickets,
logs, screenshots, or source control. The installer stores the token only in
`~/.config/zssh/gateway.env` with mode 0600.

Clients that support custom request headers may instead use:

```text
MCP URL: https://YOUR-ZSSH-DOMAIN.example/mcp
Request header: x-zssh-key: <ZSSH_API_KEY>
```

Existing bearer authentication remains available for Claude Code and other
clients that can set an `Authorization: Bearer ...` header.

## Easy VPS installation

Run this as the dedicated unprivileged VPS user (never as root):

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/bootstrap-vps.sh | bash
```

For a reproducible install, pin the source revision:

```bash
ZSSH_REF=193c287a49afa94314019254b5b30520b9ee9844 \
  bash <(curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/Zennay/zSSH/193c287a49afa94314019254b5b30520b9ee9844/deploy/bootstrap-vps.sh)
```

The bootstrap clones the canonical repository, checks out the selected revision, runs the tests, creates a non-root user service, generates a random local bearer token, and runs the live canary before declaring success. Raw shell remains disabled.

## Connect as a ChatGPT MCP app

For a private VPS, install OpenAI's `tunnel-client` and create a tunnel in Platform settings. Then run:

```bash
cd ~/.local/src/zssh
bash deploy/configure-tunnel.sh
```

The helper asks for the tunnel ID and runtime key, stores the key with mode 0600, configures the loopback-only MCP route, enables `zssh-tunnel.service`, and runs the tunnel doctor check. In ChatGPT web, enable Developer mode, choose Apps → Create → Tunnel, select the tunnel, scan the tools, and create the app. See OpenAI's Secure MCP Tunnel documentation for current plan and workspace requirements.

The helper sets `ZSSH_TRUST_LOCAL_TUNNEL=1` only for the loopback tunnel path. It never enables raw shell. To enable full shell on a disposable/trusted target, change `ZSSH_EXEC_MODE=full` explicitly in `~/.config/zssh/gateway.env`, restart `zssh.service`, and review the audit log first.

For a private target where `zssh_exec` must be able to call `sudo`, the user service intentionally runs with `NoNewPrivileges=false`. This only permits privilege escalation; it does not grant it by itself. The operating-system sudoers policy remains the authorization boundary, so only configure `NOPASSWD` privileges you deliberately want zSSH to have.

## Canonical project docs

- Project HQ: https://app.notion.com/p/3e89e19ac955811a9008d420e3e2a634
- Handoff: https://app.notion.com/p/3e89e19ac95581639bdcdc9daeb37ae8


## Repository migration

The original bootstrap lived temporarily under `Zennay/zCloud/zssh/`. The standalone repository is now authoritative. Temporary HaxLab runner transport scripts were migrated into `ops/` for traceability; HaxLab itself is no longer part of zSSH's source or deployment ownership.
