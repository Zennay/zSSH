---
name: setup
description: Connect a privately installed zSSH plugin to your Linux VPS through an HTTPS IP endpoint and private Bearer token, and diagnose connection failures.
---

# Set up zSSH Private

This is the **manual/private plugin variant**, not the public OAuth plugin submitted to the directory. It is intended for a user-owned Linux target. Its \`mcp.json\` points at a fixed public HTTPS IPv4 address supplied when the ZIP was built, with \`auth.type: api_key\` and \`headerScheme: bearer\`.

1. **Verify endpoint and TLS.** Check that the plugin points at the expected \`https://<IPv4>/mcp\`, that the server is up, and that its certificate is valid and trusted for the exact IP. A ZIP cannot deploy your gateway or provision certificates. Never instruct the user to disable certificate validation.
2. **Connect using the client's credential UI.** Obtain the existing private zSSH Bearer token through the *client's secure authentication UI*, not through chat or the ZIP. Never ask the user to paste bearer tokens, private keys, SSH passwords, or API keys into conversation. The plugin ZIP contains no secrets. If the installed client does not offer an API-key credential entry, state this limitation; do not embed a token into literal MCP headers, fake OAuth, or disable authorization.
3. **Check authentication.** A 401 response from unauthenticated \`/mcp\` is expected. After adding a valid credential, list real MCP tools and run one read-only tool that the server actually exposes. Public OAuth pairing is a separate gateway mode and does not apply to the private Bearer profile.
4. **Use server tools safely.** Respect zSSH server policy and the client's approval settings. Ask for explicit task intent before shell execution, file writes, or restarts. Never open a public unauthenticated command-execution service.
5. **Report distinct states.** Distinguish installed package, HTTPS reachability, trusted certificate, client authentication, authorization and an actual successful tool call. Do not claim that a ZIP alone establishes a working SSH connection.

The public zSSH OAuth submission package remains a separate release profile. There is no requirement to publish this private ZIP in the OpenAI public directory.
