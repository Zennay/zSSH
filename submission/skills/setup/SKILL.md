---
name: setup
description: Set up the zSSH plugin in ChatGPT, diagnose a missing connection or login button, and pair an authenticated profile with an owned Linux target.
---

# Connect zSSH

zSSH's public plugin does **not** accept a server IP address, SSH password, or SSH private key in ChatGPT. The plugin connects to one configured HTTPS MCP gateway; a target-side outbound agent connects your Linux machine to that gateway. OAuth identifies the ChatGPT user. The Linux owner must separately approve pairing. Never ask for or expose bearer tokens, private keys, Cloudflare tokens, or SSH passwords.

**Version and publication check.** This setup workflow is included in source version 0.1.2; an older cached 0.1.0 installation will not gain it merely because GitHub changed. Confirm that the currently installed package was built from the new release. If the public HTTPS gateway has not been published or the updated bundle has not been distributed, explain that account linking cannot work yet. Do not recommend the retired `cheapgpt.shop` domain or claim that reinstallation alone fixes an unpublished endpoint.

1. **Check plugin availability.** Look for the zSSH MCP tools, especially `get_pairing_status` and `get_system_uptime`. If none are available, explain that selecting a skill or installing the plugin does not by itself prove that the remote MCP server is connected. Ask the user to check the plugin's connection/account-linking status in ChatGPT. Do not claim to have checked the server.
2. **Authenticate.** If the tool requests authorization, direct the user through ChatGPT's OAuth connection flow. Do not request that an access token be pasted into chat. If ChatGPT offers no login/connection option, the operator must check the plugin's `mcp.json` OAuth declaration, public HTTPS `/mcp` URL, RFC 9728 protected-resource metadata, and the OAuth issuer's discovery configuration.
3. **Request pairing.** Once authenticated, call `get_pairing_status`. If the returned status is pending, show the short-lived `pair_...` request ID. Do not confuse authentication with approval.
4. **Approve locally.** For the public outbound-agent deployment, tell the Linux target owner to run `node agent.mjs approve <request-id>` in the installed zSSH source directory with the target agent's configured identity/environment. Only a target owner can execute this step. For a legacy gateway and Linux target co-located on the same machine, the local-only command is `node pairing-cli.mjs approve <request-id>` with the gateway's configured pairing registry. Never attempt to approve pairing through a public MCP tool.
5. **Verify.** Call `get_pairing_status` again and expect `paired: true`, then use `get_system_uptime` as a read-only smoke test. Report separately whether OAuth, pairing, live target transport, and uptime actually succeeded.

If the target is not registered or the agent is offline, explain that the target owner must provision the outbound agent and the gateway's trusted public key using the zSSH repository deployment instructions. These are *server-side* settings; there is no per-user arbitrary SSH hostname field in the public plugin.

If the OpenAI public production service has not yet been published, report that explicitly instead of presenting a non-working connection UI as a user misconfiguration. Do not suggest bypassing OAuth or pairing to make the interface work.
