# Connect zSSH to ChatGPT (private link + OAuth)

Updated: 2026-10-16

zSSH intentionally keeps two connection modes. Configure them as **two separate ChatGPT MCP connections**; do not make OAuth fall back to a private token URL or expose the private tool surface on the public OAuth endpoint.

## Before you start: ChatGPT account access

ChatGPT's custom MCP connection UI is rolling out by plan and workspace. Current OpenAI guidance lists Business and Enterprise/Edu for full MCP; Pro has limited read/fetch access. Plus is not listed in the current availability guidance. If **Settings → Apps** (or **Plugins → + → Add custom MCP server**) is absent, the account/workspace cannot add a custom MCP server yet. That is not a zSSH endpoint failure.

Official guidance:
- [Connect custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)

ChatGPT connects to a **remote HTTPS** MCP endpoint. Do not enter a loopback URL such as `http://127.0.0.1:8788/mcp`, a private LAN IP, or an HTTP-only VPS URL. The public HTTPS endpoint must have a valid certificate and forward MCP requests to the correct zSSH service.

## 1. Fix the VPS command location first

The errors from running `npm ci` and `npm test` in `/home/ubuntu` mean the shell was outside the repository: npm looked for `/home/ubuntu/package.json`. In addition, the current repository revision does not include a `package-lock.json`, so `npm ci` cannot work yet.

Run these commands on the VPS:

```bash
# If you already cloned it:
cd ~/zSSH

# If ~/zSSH does not exist, clone it first instead:
# git clone https://github.com/Zennay/zSSH.git ~/zSSH
# cd ~/zSSH

npm install
npm test
```

Use `npm install` until the repository has a committed lockfile. Do not run npm commands from your home directory.

## 2. Option A — private revocable link (choose “No authentication” in ChatGPT)

This preserves the existing private-link workflow. ChatGPT sends no Authorization header; the high-entropy token embedded in the URL authenticates the request. **This is not an anonymous/public endpoint. Treat the full URL like a password.**

### Configure the private gateway

Use the private profile on its own service (the default local port is 8788). Configure the service environment / `~/.config/zssh/gateway.env` with values like these, adjusted to your actual hostname and narrow target paths:

```dotenv
PORT=8788
ZSSH_PLUGIN_PROFILE=private
ZSSH_EXEC_MODE=disabled
ZSSH_ALLOWED_ROOTS=/srv/zssh-owned
ZSSH_CLIENT_TOKENS_FILE=/home/ubuntu/.config/zssh/clients.json
ZSSH_PUBLIC_URL=https://YOUR-OWNED-HOSTNAME
```

- Run zSSH as a dedicated **non-root** user.
- Keep `ZSSH_EXEC_MODE=disabled`; do not enable unrestricted shell for a ChatGPT connection.
- Set `ZSSH_ALLOWED_ROOTS` to only the directory that this connection needs. Do not copy the example path blindly.
- Keep the HTTPS reverse proxy in front of the service and route the private endpoint path unchanged to port 8788. Do not expose port 8788 directly to the internet.
- Configure the CLI and the running service to use the **same** `ZSSH_CLIENT_TOKENS_FILE`.

Restart the private service after changing its environment, then create a unique, revocable link:

```bash
zssh connect chatgpt
```

The CLI prints an `mcp_url` such as `https://YOUR-OWNED-HOSTNAME/mcp/zssh_<id>_<secret>`. Copy that URL directly into ChatGPT's connection URL field. Do not paste it into a prompt, GitHub issue, commit, screenshot, or shared document.

### Add it in ChatGPT

1. Open **Settings → Apps** (or the available **Plugins** page).
2. Choose **+ → Add custom MCP server**.
3. Name it `zSSH Private`.
4. Paste the complete `mcp_url` from `zssh connect chatgpt` as the connection URL. Keep the token path exactly as printed.
5. Select **No authentication** in ChatGPT. Do not also configure OAuth or a static API key for this entry.
6. Acknowledge the server risk warning, create the connection, and inspect the discovered tools before using it.

To revoke a lost or unwanted link, find its client ID and revoke it:

```bash
zssh token list
zssh token revoke CLIENT_ID
```

Revocation is per client. Create a new link with `zssh connect chatgpt` when needed.

## 3. Option B — OAuth-protected public connection

Use the separate **public** gateway for OAuth. Its MCP endpoint is the plain `https://YOUR-OWNED-HOSTNAME/mcp` URL (no client-token path). ChatGPT completes OAuth; zSSH verifies the token and scopes, and the Linux target still requires local pairing approval.

The public service normally uses loopback port 8789 behind a reverse proxy, separate from the private service on 8788. Configure an owned public DNS hostname, a valid TLS certificate, an OAuth/OIDC provider that supports Authorization Code + PKCE (S256), issuer/JWKS metadata, a narrow `ZSSH_PUBLIC_ALLOWED_ROOTS`, and the paired target-agent trust configuration. Then use the documented deployment preflight:

```bash
ZSSH_PUBLIC_BASE_URL=https://YOUR-OWNED-HOSTNAME
ZSSH_OAUTH_ISSUER=https://YOUR-OAUTH-ISSUER
ZSSH_OAUTH_JWKS_URI=https://YOUR-OAUTH-ISSUER/.well-known/jwks.json
ZSSH_PLUGIN_PROFILE=public
ZSSH_PUBLIC_AUTH_MODE=oauth
ZSSH_PUBLIC_ALLOWED_ROOTS=/srv/zssh-review
```

These are configuration examples, not a complete deployment command: use the actual issuer/JWKS values from your identity provider and complete the target-agent and protected service configuration in the public-gateway runbook. See [public gateway deployment](./research/public-gateway-deployment-2026-10-04.md) and [the public release checklist](./openai-plugin-release-checklist.md).

**Current production blocker:** GitHub issue [#159 — M5 active gate: dns_publication](https://github.com/Zennay/zSSH/issues/159) says the public release lane is waiting for a hostname on a domain the operator owns and the matching protected Cloudflare DNS credentials. The retired `cheapgpt.shop` hostname must not be reused. Do not mark the OAuth connection live until the owned DNS/TLS endpoint, OAuth flow, and target pairing have passed their real checks.

### Add the OAuth entry in ChatGPT

1. Add another custom MCP server using the same ChatGPT settings path.
2. Name it `zSSH OAuth`.
3. Use `https://YOUR-OWNED-HOSTNAME/mcp` as the connection URL.
4. Select **OAuth**, complete the provider's sign-in and consent, then wait for the tool scan to finish.
5. Confirm the current profile is paired to the intended Linux target. Approve pairing locally on that target; OAuth login alone must not grant target access.

Keep this as a separate connection from `zSSH Private`. The public OAuth profile deliberately refuses private token URLs as an authentication fallback.

## 4. Verify the connection

After adding a connection, open a new chat, select the zSSH connection from the tools menu (or mention it if your ChatGPT UI supports that), and start with a read-only request:

- “Check the zSSH server version and connection status.”
- “Show the connected Linux server's uptime and disk usage.”
- “Read a harmless test file inside the configured allowed root.”

For the OAuth profile, also test an unpaired profile and confirm it cannot read or write target files until local pairing is approved. For the private-link profile, revoke the test client and confirm that its URL no longer works.

## Security boundary

- The private link is a **bearer capability in the URL**, even though ChatGPT's auth dropdown says “No authentication.” Anyone holding it can exercise the permissions of that client.
- OAuth is the better choice for multiple users and scoped authorization, but it needs a real provider, HTTPS, and local target pairing.
- Do not reuse the private URL as the OAuth endpoint, and do not configure a public OAuth service to fall back to private tokens.
- A green local test or GitHub CI run is not proof that the live ChatGPT endpoint, TLS, OAuth login, or pairing is working.
