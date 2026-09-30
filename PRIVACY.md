# zSSH Privacy

zSSH's default architecture is self-hosted.

When a user installs zSSH on their own Linux server, the MCP service, policy configuration, client-token hashes, audit log, and command execution live on that server.

The default zSSH runtime does not require a Zennay-operated relay, command server, VPS, credential database, or execution backend.

Data may leave the target when the operator deliberately configures an external dependency, for example:

- a public DNS provider or reverse proxy;
- an MCP tunnel;
- a Git remote used by an explicit Git operation;
- an MCP client such as ChatGPT or Claude.

Those systems have their own data-handling terms and policies.

zSSH redacts common secret patterns from tool output and audit command data, but redaction is a defense-in-depth measure rather than a guarantee that arbitrary sensitive content can never be returned. Operators should scope allowed roots and tools to the minimum required data.

Revocable zSSH client tokens are shown in plaintext when created. The target-local client store keeps only token hashes, labels, IDs, and creation timestamps.
