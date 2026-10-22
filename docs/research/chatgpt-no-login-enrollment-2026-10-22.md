# zSSH: one-command ChatGPT enrollment without a user login

Status: implementation branch; **do not enable on the live gateway without the mTLS ingress described below**.

## User experience

1. Add the zSSH plugin in ChatGPT.
2. Ask for a new VPS install command. `get_server_install_command` returns one command with a random 256-bit `enr_...` code.
3. Run that exact command **once** on the VPS.
4. The installer creates a local Ed25519 private key, signs the enrollment claim, and installs a persistent, outbound-only agent.
5. The gateway atomically consumes the one-use code and registers that signed host key to the verified ChatGPT subject. It can be revoked through the plugin.

The code expires after 15 minutes and cannot be reused. **The host identity does not expire when the code expires.** The systemd target agent starts on reboot, reconnects automatically, and uses signed requests, not the expired code. Compromise or theft of the unredeemed install command remains a security risk; do not share it.

## Essential trust boundary: platform identity is not a password

`_meta["openai/subject"]` identifies an anonymized ChatGPT user, but is NOT independently authenticated by zSSH. Never authorize server operations from this value on an ordinary unauthenticated/public MCP connection. This opt-in mode requires:

- ChatGPT's OpenAI-managed client certificate authenticated via **mTLS** at a dedicated ingress hostname; verify its CA chain, client-auth EKU and expected leaf SAN. See https://developers.openai.com/plugins/build/auth
- A **separate ChatGPT-only HTTPS hostname** (for example `chatgpt.zssh.zennay.nl`) requiring mTLS. Keep `zssh.zennay.nl` as the normal TLS hostname for VPS agent enrollment and signed outbound agent requests, which cannot present the ChatGPT certificate.
- The reverse proxy MUST **discard any incoming `X-Zssh-Chatgpt-Proxy-Secret`** and inject the gateway's random secret only after a successful ChatGPT mTLS check. This secret must be >=43 random base64url characters, shared only between ingress and loopback Node service.
- Node must listen on loopback only. The gateway additionally enforces loopback source + constant-time proxy-secret comparison before it accepts `openai/subject`.
- Distinct per-profile hashed owner IDs are derived server-side from the verified subject and stable resource origin. Revocation of a host prevents new agent sessions and commands.

An ingress that merely forwards a header saying "verified", or passes the shared secret to arbitrary public requests, is **NOT SECURE**. If the mTLS chain/SAN check cannot be enforced, leave `ZSSH_PUBLIC_AUTH_MODE=oauth` enabled instead. This is not a substitute for an authenticated user when the platform identity contract changes.

## Gateway runtime (central infrastructure, set up once)

After deploying the reviewed release into a separate public gateway, its private environment includes:

```dotenv
NODE_ENV=production
PORT=8789
ZSSH_PLUGIN_PROFILE=public
ZSSH_PUBLIC_AUTH_MODE=chatgpt
ZSSH_PUBLIC_BASE_URL=https://zssh.zennay.nl
ZSSH_ENROLLMENT_ENABLED=1
ZSSH_INSTALLER_REF=<PINNED_40_CHARACTER_COMMIT_SHA>
ZSSH_CHATGPT_PROXY_SECRET=<RANDOM_32_BYTE_BASE64URL_SECRET>
ZSSH_PAIRING_REQUIRED=1
ZSSH_EXEC_MODE=disabled
ZSSH_PUBLIC_ALLOWED_ROOTS=/home/zssh/public-review
```

Keep `ZSSH_ENROLLMENT_FILE` on persistent 0700 private storage, and `gateway-public.env` mode 0600. Do not copy the private gateway API keys, bearer tokens or client token store. Do not expose raw shell, or open a new inbound port on an enrolled VPS. The deployed installer and the gateway need a mutually compatible pinned release.

The Caddy configuration must terminate mTLS on the ChatGPT-only host, enforce OpenAI's client certificate requirements, strip untrusted proxy-secret headers, and set the private header **only** on accepted MCP requests. Configure a normal TLS route for `zssh.zennay.nl` to the same loopback gateway for `/enrollment/v1/claim` and signed agent endpoints. Do not copy a permissive reverse-proxy snippet without these checks.

## Isolated Caddy ingress (prepared, not deployed)

An opt-in dual-host example is included at `deploy/Caddyfile.chatgpt-mtls.example`. It keeps `https://zssh.zennay.nl` open only for `/health`, signed agent requests and a one-use enrollment claim; anonymous MCP routing is deliberately absent there. The `chatgpt.zssh.zennay.nl` hostname requests and verifies an OpenAI-issued client certificate and only then routes `/mcp`, injecting the locally configured proxy secret. Both public hostnames need separate DNS A records and valid server certificates.

**Caddy must be at least v2.11.0**. The earlier v2.10.2 release was affected by [GHSA-hffm-g8v7-wrv7](https://github.com/caddyserver/caddy/security/advisories/GHSA-hffm-g8v7-wrv7), in which unreadable CA trust files could cause client trust validation to fail open. Download the current OpenAI Root and Connectors intermediate certificates only from the [official OpenAI mTLS guide](https://developers.openai.com/plugins/build/auth). Store the intermediate PEM as `/etc/caddy/openai-connectors-mtls-intermediate.pem` with appropriate read access for Caddy, check its chain, and validate the client SAN `mtls.prod.connectors.openai.com`. Do not disable `require_and_verify` or add a catch-all reverse proxy on the ChatGPT-only host.

Provision a 32-byte random base64url `ZSSH_CHATGPT_PROXY_SECRET` only in the central gateway's private environment and the Caddy service environment, not in the public Caddyfile, command lines, GitHub, Notion or chat. The Caddy example overwrites this header *only* on a verified mTLS request and removes it from signed agent routes. Require a fail-closed preflight if Caddy's secret value or intermediate CA trust is absent.

**User-level authorization caveat:** OpenAI documents `openai/subject` for identification and rate limiting, not as a general replacement for user authentication. The mTLS client certificate authenticates ChatGPT (the client), not an individual human. Before enabling write-capable privileged target tools for multiple users, the owner/profile binding must be independently audited; use OAuth or a separate user-scoped secure authorization mechanism if that security claim cannot be substantiated. An unverified `openai/subject` or header must never authorize a target.

## Gateway switch-over gates

- Preserve existing `zssh.service` on port 8788 (private, no new remote access).
- Update the separately installed `zssh-public.service` from a pinned release and enable it for reboot persistence only when its configuration has been reviewed.
- In `chatgpt` mode no OAuth metadata or login is offered; `/mcp` without the verified proxy attestation must return 401.
- The signed enroll claim endpoint remains publicly callable over ordinary HTTPS **only with a 256-bit, unused, unexpired code**; it is rate limited.
- Check that the trusted ChatGPT connection can generate a one-use command, the target can claim it, the enrolled agent stays connected across a reboot, and revocation blocks future agent sessions.
- Do not switch the existing public plugin or turn off Auth0 until dedicated ChatGPT mTLS ingress and host provisioning have been confirmed. Old OAuth mode is preserved as fallback.

## Limitations

This branch does not deploy DNS, provision the OpenAI client-CA trust material, configure Caddy, or publish/install the plugin in ChatGPT. Claiming a guaranteed "100% only you" binding is inappropriate: command interception before first use or errors in the mTLS ingress configuration remain threats.
