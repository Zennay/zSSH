# Build an installable private zSSH plugin ZIP for an HTTPS IP

This route is **not** the public OpenAI submission flow. It preserves the
production OAuth submission builder and its strict hostname/review checks.
For personal use on an existing HTTPS IPv4 endpoint, it produces a standalone,
deterministic ZIP with an API-key/Bearer authentication declaration and an
onboarding skill.

## Build

From the repository root:

\`\`\`bash
python3 scripts/build-private-plugin.py \
  --mcp-url https://198.244.191.182/mcp \
  --output dist/zssh-private-ip-plugin.zip
python3 scripts/private-plugin-canary.py
\`\`\`

Result: \`dist/zssh-private-ip-plugin.zip\`. The ZIP contains
\`plugin.json\`, \`mcp.json\`, \`assets/icon.svg\`,
\`skills/setup/SKILL.md\`, and \`README.txt\`.

It intentionally has a **separate identity** (\`zssh-private\`) and
prerelease version (\`0.1.3-private.1\`) to avoid replacing the public
OAuth profile or colliding with cached zSSH v0.1.0/v0.1.2 installations.

## Connection

- Use a plugin client that supports installing private Agent Plugin ZIPs.
- The MCP URL is permanently set at build time; the ZIP cannot edit a running
  server, install a certificate, or configure firewall ingress.
- A public IP is fine for this **private** package **if** the URL uses HTTPS
  and the certificate is valid and trusted for that literal IP address.
  The builder verifies URL shape but cannot certify remote TLS health.
- The endpoint must already accept a private, revocable zSSH Bearer token.
  Declare it through the **client's secured connection/authentication setup**.
  Never paste tokens into \`mcp.json\`, repository commits, package files,
  URLs, chat messages, or unaudited logs.
- The packaged \`auth\` object is \`{"type":"api_key","headerScheme":"bearer"}\`.
  API-key authentication does not require an OAuth provider.
- Some ChatGPT plugin submission/connection surfaces do not accept manual API
  keys. If the installation UI offers no secure credential entry, use a
  supported private desktop client or an appropriately configured private
  connector; **do not** change the server to unauthenticated or hardcode tokens
  in the ZIP.
- HTTP 401 **without** credentials is expected. Check gateway availability,
  certificate trust, credentials, and authorized tool list independently.
- The public OAuth pairing flow is a **different** deployment profile and
  must not be assumed to apply here.

## Test

The reproducibility and safety canary rejects HTTP, local/private/non-IPv4
hosts, nonstandard ports, URL secrets, query strings, fragments, and non-\`/mcp\`
paths; builds two ZIPs and verifies identical SHA-256, manifest identity,
no OAuth substitution, secret-free transport headers, API-key/Bearer declaration,
and the presence of setup instructions.

**Important:** A valid ZIP does not by itself prove server connectivity. Run
a real authenticated MCP tool call from the installed client to validate
end-to-end operation.

## Public release remains separate

The existing \`npm run plugin:build\` / public submission pipeline still
requires a verified DNS hostname, real OAuth identity provider, reviewer
fixture, and OpenAI portal checks. This private ZIP route changes none of
those gates.
