# zSSH for Claude

Connects Claude to your own zSSH VPS gateway using remote MCP and OAuth.
No SSH private key or bearer token belongs in this plugin.

For Claude Code, enable the plugin and enter your HTTPS `/mcp` URL when asked.
For web/desktop uploads, prefer an archive built with `--url` so its endpoint is
already set. Then authenticate with the connector's Connect button. If the
plugin upload does not create the connector in your Claude surface, add its
same `/mcp` URL under Customize → Connectors → Add custom connector.

The owner connection code is entered on your gateway's login page. It is never
passed to the model. Tools execute on the VPS where the gateway is installed.
Use SSH for initial installation; runtime operations go over authenticated
HTTPS. Restarting the gateway revokes its OAuth sessions; connect again.

Full setup instructions are in the repository's `docs/claude.md`.
