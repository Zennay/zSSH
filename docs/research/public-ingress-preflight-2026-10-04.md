# External public-ingress preflight — 2026-10-04

## Primary-source refresh

- https://developers.openai.com/plugins/build/mcp-server
  - Public submission requires a stable, publicly reachable HTTPS MCP endpoint.
  - The production endpoint must remain reachable for review and domain verification.
  - Temporary/development tunnels do not satisfy the public-submission requirement.
- https://developers.openai.com/plugins/deploy/app-review
  - Remote MCP review requires a publicly accessible production domain rather than a local or testing endpoint.
- https://developers.openai.com/plugins/deploy/submission
  - The portal connects the exact MCP server URL, completes domain verification, authenticates when required, then scans the live tools.
  - Changing an existing MCP server URL after connection is not the normal update path, so the production origin should be proven before portal binding.
- https://developers.openai.com/plugins/deploy/submission-errors
  - Final remote-MCP submission requires a production HTTPS MCP URL, completed domain verification, and a successful current tool scan.
  - example.com links are illustrative submission examples, not working production materials.

## Engineering decision

Add an external, credential-free ingress preflight that can be run from GitHub-hosted infrastructure before the full production submission probe. It proves only facts that should be independently observable from the public internet:

1. the exact submitted URL is HTTPS and ends at `/mcp`;
2. public DNS resolves and does not return private, link-local, benchmark, or documentation-only addresses;
3. the same origin serves a healthy zSSH `/health` response over validated HTTPS;
4. unauthenticated MCP initialization fails closed with HTTP 401;
5. the Bearer challenge points to the exact same-origin protected-resource metadata URL;
6. protected-resource metadata names the exact production origin and at least one authorization server.

The check deliberately does not accept credentials and does not claim that reviewer login, OAuth authorization code flow, target pairing, demo recording, OpenAI domain verification, Scan Tools, or ChatGPT desktop/mobile review are complete. Those remain later gates.

The shared production URL guard is also hardened so `example.com`, `example.net`, `example.org` and their subdomains cannot be mistaken for public production endpoints.


## Final protected-release binding — 2026-10-04

The final `workflow_dispatch` production release gate now reruns this same external ingress proof against the exact configured `ZSSH_PLUGIN_MCP_URL` before the end-to-end submission probe. The resulting non-secret JSON is uploaded with preflight/release artifacts and is parsed again while the release receipt is assembled.

The receipt fails closed unless the ingress evidence belongs to the exact submitted MCP URL and proves healthy HTTPS, the unauthenticated MCP 401 boundary, and protected-resource metadata. This removes a checklist gap where a separately green ingress run could otherwise become stale before the final protected release.
