# zSSH public plugin release checklist

## Release gate

This checklist tracks the production path from the current review-ready MCP profile to a public OpenAI plugin release.

## Pre-release

- [ ] Stable public HTTPS MCP endpoint configured
- [ ] Production OAuth authorization server configured with PKCE support
- [ ] Resource-server metadata points to the production MCP resource
- [ ] Health, OAuth metadata, challenge, and unauthenticated MCP checks do not redirect away from the submitted origin
- [ ] `WWW-Authenticate` advertises the exact same-origin `/.well-known/oauth-protected-resource` URL
- [ ] Domain verification challenge is live
- [ ] Reviewer account exists without private user data
- [ ] Dedicated paired target fixture is available

## Automated validation

Run:

```bash
npm test
npm run submission:probe
```

Verify:

- no generic executor tools are exposed in public profile;
- read-only annotations remain correct;
- sensitive paths are rejected;
- reviewer file fixture remains bounded to the configured public root;
- tokens and credentials are never printed;
- release checks fail closed on redirects or mismatched OAuth resource-metadata challenge URLs.

## Submission evidence

Record:

- production endpoint version/revision;
- CI run result for the exact commit;
- VPS rollout proof from the dedicated `Zennay/zCloud` `zSSH standalone VPS release` workflow, pinned to the exact canonical zSSH commit;
- SHA-256 fingerprint of the exact public tool metadata returned by the production scan;
- reviewer walkthrough result;
- portal scan findings and resolutions.

A green local canary alone does not indicate production submission readiness. The zSSH repository intentionally does not own the VPS runner; live rollout evidence is produced through the dedicated zCloud VPS release lane so repository-scoped runner queues cannot masquerade as deployment proof.
