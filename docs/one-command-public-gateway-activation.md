# zSSH one-command public gateway activation

This runbook is for the *OAuth-bound public gateway*, not the existing private zSSH
service on port 8788. It assumes the implementation in PR #389 is reviewed and
merged, and uses an immutable release commit SHA. Do not claim a public release
is live merely because the plugin ZIP exists.

## Safe rollout topology

- Preserve the existing private `https://zssh.zennay.nl/mcp/` service and DNS.
- Suggested isolated public origin: `https://connect.zennay.nl` (not created yet).
- On the new VPS, `zssh-public.service` runs as an unprivileged user on
  `127.0.0.1:8789`, behind Caddy with automatic HTTPS.
- User VPS agents make **outbound** HTTPS requests to the gateway. Do not open
  ports 8788 or 8789 to the internet or share SSH private keys.
- A plugin connected to the new public origin has no relationship to an older
  private plugin pointed at port 8788.

## 1. DNS and HTTPS (external)

Find the verified public IPv4 of your intended gateway VPS in your host panel.
Create **only** an A record `connect.zennay.nl` to that IP, checking for
conflicting AAAA/CNAME/HTTPS records first. Leave `zssh.zennay.nl` unchanged.
No DNS provider is assumed; do not provision Cloudflare credentials if the
domain is hosted elsewhere.

On the gateway VPS, ensure ports TCP 80/443 are reachable and add the following
Caddy **site block** to the existing Caddyfile:

```caddyfile
connect.zennay.nl {
    reverse_proxy 127.0.0.1:8789
}
```

Then validate and reload Caddy. Only reload after the DNS is correct; Caddy
needs a publicly trusted certificate for the hostname.

## 2. Set up an Auth0 OAuth issuer (external)

In a real Auth0 tenant:

1. Enable Dynamic Client Registration (DCR), strict third-party mode,
   authorization-code + PKCE S256, and the resource-parameter compatibility
   profile. Enable RFC 9207 `iss` response identification. Ensure the public
   authorization-server metadata advertises these features.
2. Create an Auth0 API whose **Identifier / Audience** is exactly
   `https://connect.zennay.nl`. Use RS256 access tokens. Define exactly
   `zssh:read` and `zssh:write` API scopes and a user-delegated third-party
   default grant restricted to these scopes.
3. Record the exact Auth0 issuer **including its trailing slash**, e.g.
   `https://YOUR-TENANT.eu.auth0.com/`, and its canonical
   `https://YOUR-TENANT.eu.auth0.com/.well-known/jwks.json`.
4. Do not paste Auth0 Management API tokens, OAuth client secrets, passwords or
   reviewer account credentials into ChatGPT, GitHub, or shell transcripts.
   Protected GitHub environments can store credentials if automated provider
   qualification is desired.

Required public reference:
https://developers.openai.com/plugins/build/auth

The OpenAI OAuth client uses the `resource` parameter and dynamic client
registration; client callbacks must be allowed as indicated by the ChatGPT
connection UI. The issuer in tokens must match the configured issuer *exactly*.

## 3. Deploy the isolated gateway (after PR merge/review)

On the NEW VPS, in a shell for the existing **unprivileged** `zssh` user,
use a reviewed immutable zSSH checkout (not a moving branch). First ensure
`zssh` has working systemd user services and a writable private workspace.

Example environment (replace placeholders, not secrets; run as `zssh`):

```bash
cd "$HOME/.local/src/zssh"
git fetch origin main
git checkout --detach origin/main
mkdir -p "$HOME/zssh-workspace"
chmod 700 "$HOME/zssh-workspace"
export ZSSH_PUBLIC_BASE_URL=https://connect.zennay.nl
export ZSSH_OAUTH_ISSUER=https://YOUR-TENANT.eu.auth0.com/
export ZSSH_OAUTH_JWKS_URI=https://YOUR-TENANT.eu.auth0.com/.well-known/jwks.json
export ZSSH_PUBLIC_ALLOWED_ROOTS="$HOME/zssh-workspace"
export ZSSH_ENROLLMENT_ENABLED=1
export ZSSH_INSTALLER_REF="$(git rev-parse HEAD)"
export ZSSH_EXPECTED_SHA="$ZSSH_INSTALLER_REF"
# IMPORTANT: these are for the old static reviewer gateway; leave unset:
unset ZSSH_TARGET_ID ZSSH_AGENT_PUBLIC_KEYS_FILE
# Check configuration without writing or starting a service.
ZSSH_PUBLIC_GATEWAY_VALIDATE_ONLY=1 bash deploy/install-public-gateway.sh
# Only after the preflight and provider/hostname verification succeed:
bash deploy/install-public-gateway.sh
systemctl --user is-active zssh-public.service
curl --fail http://127.0.0.1:8789/health
```

This requires the enrollment-mode changes in PR #389. The installer writes
`~/.config/zssh/public-gateway.env` (private permissions), starts the isolated
systemd user service, and keeps the legacy private gateway unchanged.
It must not include legacy static `ZSSH_AGENT_PUBLIC_KEYS_FILE` or
`ZSSH_TARGET_ID` in dynamic enrollment mode.

## 4. Confirm public OAuth metadata and MCP

After Caddy has issued its HTTPS certificate, verify externally:

```bash
curl -fsS https://connect.zennay.nl/health
curl -fsS https://connect.zennay.nl/.well-known/oauth-protected-resource
curl -i https://connect.zennay.nl/mcp
```

The metadata should identify the Auth0 issuer and
`resource=https://connect.zennay.nl`. Unauthenticated MCP access should be
rejected with a 401 challenge. A healthy `/health` response alone does not
prove OAuth registration, JWT validation or enrollment works.

## 5. Register/install the matching ChatGPT plugin

The final public plugin manifest MUST point to
`https://connect.zennay.nl/mcp`, **not** to the old private
`https://zssh.zennay.nl/mcp/`. Rebuild the ZIP after the new origin is online;
the earlier preview ZIP is not automatically retargeted.

Use ChatGPT's plugin/account linking UI to sign in to the **real** Auth0 tenant.
Invoke `get_server_install_command` to issue an account-bound 15-minute
single-use command. Paste it on the owned Linux host. The terminal prints
`ZSSH_TARGET_FINGERPRINT`; the owner must explicitly compare it with
`get_server_enrollment_status` and approve through
`approve_server_enrollment`. Verify read-only `zssh_server_info` returns the
expected target identity. Revoke using `revoke_enrolled_server`.

**Security:** Enrollment never opens raw SSH/MCP on the target. The public
zSSH tool surface is intentionally limited; it does not provide the private
plugin's unrestricted `zssh_exec`. Keep public release behind domain,
OAuth, reviewer and store-concurrency gates until those are evidenced.
