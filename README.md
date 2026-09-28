# zSSH

zSSH is a **standalone security-first remote operations project**. zCloud is its control-plane/dashboard integration, not its parent project.

## Current milestone

**M1 — Safe local execution proof.** M0 and the standalone repository migration are complete.

This branch proves the smallest safe foundation:

- remote MCP endpoint at `/mcp`;
- development bearer authentication;
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

Production hardening still requires a dedicated service account, scoped sudo/capabilities, stronger approval semantics, rate limiting, OAuth-compatible user auth, agent pairing, and review against current ChatGPT plugin requirements.

## ChatGPT integration status

OpenAI's current plugin documentation uses remote MCP over streamable HTTP. Public submission requires a stable public HTTPS endpoint. Development bearer auth is temporary; OAuth-compatible user authentication, target pairing, and public submission remain later milestones. The loopback gateway is not yet a plugin that normal ChatGPT chats can select.

## Easy VPS installation

Run this as the dedicated unprivileged VPS user (never as root):

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/Zennay/zSSH/main/deploy/bootstrap-vps.sh | bash
```

For a reproducible install, pin the source revision:

```bash
ZSSH_REF=7499713db2a795f346ed9d45ad45dbc91fef44e2 \
  bash <(curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/Zennay/zSSH/7499713db2a795f346ed9d45ad45dbc91fef44e2/deploy/bootstrap-vps.sh)
```

The bootstrap clones the canonical repository, checks out the selected revision, runs the tests, creates a non-root user service, generates a random local bearer token, and runs the live canary before declaring success. Raw shell remains disabled.

## Connect as a ChatGPT MCP app

For a private VPS, install OpenAI's `tunnel-client` and create a tunnel in Platform settings. Then run:

```bash
bash deploy/configure-tunnel.sh
```

The helper asks for the tunnel ID and runtime key, stores the key with mode 0600, configures the loopback-only MCP route, enables `zssh-tunnel.service`, and runs the tunnel doctor check. In ChatGPT web, enable Developer mode, choose Apps → Create → Tunnel, select the tunnel, scan the tools, and create the app. See OpenAI's Secure MCP Tunnel documentation for current plan and workspace requirements.

The helper sets `ZSSH_TRUST_LOCAL_TUNNEL=1` only for the loopback tunnel path. It never enables raw shell. To enable full shell on a disposable/trusted target, change `ZSSH_EXEC_MODE=full` explicitly in `~/.config/zssh/gateway.env`, restart `zssh.service`, and review the audit log first.

## Canonical project docs

- Project HQ: https://app.notion.com/p/3e89e19ac955811a9008d420e3e2a634
- Handoff: https://app.notion.com/p/3e89e19ac95581639bdcdc9daeb37ae8


## Repository migration

The original bootstrap lived temporarily under `Zennay/zCloud/zssh/`. The standalone repository is now authoritative. Temporary HaxLab runner transport scripts were migrated into `ops/` for traceability; HaxLab itself is no longer part of zSSH's source or deployment ownership.
