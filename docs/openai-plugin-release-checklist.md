# zSSH public plugin release checklist

## Release gate

This checklist tracks the production path from the current review-ready MCP profile to a public OpenAI plugin release.

## Pre-release

- [ ] Stable public HTTPS MCP endpoint configured
- [ ] Production OAuth authorization server publishes discovery metadata with authorization-code flow, PKCE S256, and token endpoint auth methods
- [ ] Resource-server metadata points to the production MCP resource
- [ ] Health, OAuth metadata, challenge, and unauthenticated MCP checks do not redirect away from the submitted origin
- [ ] `WWW-Authenticate` advertises the exact same-origin `/.well-known/oauth-protected-resource` URL
- [ ] Domain verification challenge is live
- [ ] Reviewer account exists without private user data
- [ ] Dedicated paired target fixture is available
- [ ] Production connection card exercised successfully in ChatGPT desktop; only then set `ZSSH_CHATGPT_DESKTOP_REVIEWED=1`
- [ ] Production connection card exercised successfully in ChatGPT mobile; only then set `ZSSH_CHATGPT_MOBILE_REVIEWED=1`
- [ ] OpenAI Scan Tools is green for the exact production tool contract; set `ZSSH_OPENAI_TOOL_SCAN_VERIFIED=1` and `ZSSH_OPENAI_TOOL_SCAN_SHA256=<live tool_scan_sha256>` only after that exact scan

## Canonical release provenance

Production submission is dispatched only from canonical `main`. Before the production environment is entered, the release gate verifies through GitHub's commit→pull-request association that the exact `GITHUB_SHA` is the merge commit of a closed, merged PR. Direct commits to `main` therefore cannot become production submission candidates. The separate `Canonical main provenance` workflow also checks every push to `main`.

Do not use commit-message-triggered production probes. Use the `workflow_dispatch` action on the exact reviewed `main` revision.

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
- release checks fail closed on redirects or mismatched OAuth resource-metadata challenge URLs;
- the production probe resolves the advertised authorization server and validates issuer binding, authorization/token endpoints, authorization-code support, PKCE S256, and declared token endpoint auth methods.

## Reproducible submission bundle

The release bundle is built from the committed `submission/assets/icon.svg`, the protected production MCP URL, and the protected demo-recording URL. CI builds the ZIP twice and requires an identical SHA-256. The production release gate uploads the exact ZIP together with a non-secret evidence JSON so a portal upload can be tied back to one commit and one tool scan.

## Submission evidence

Record:

- production endpoint version/revision;
- CI run result for the exact commit;
- merged PR number and merge timestamp proving canonical main provenance;
- VPS rollout proof from the dedicated `Zennay/zCloud` `zSSH standalone VPS release` workflow, pinned to the exact canonical zSSH commit;
- SHA-256 fingerprint of the exact public tool metadata returned by the production probe, with `ZSSH_OPENAI_TOOL_SCAN_SHA256` required to match it exactly after the portal scan;
- SHA-256 of the exact `zssh-openai-plugin.zip` uploaded by the production release gate;
- plugin version, currently `0.1.2`, matching `package.json` and `submission/plugin.template.json`;
- authorization-server metadata URL(s), issuer(s), and PKCE S256 evidence emitted by the production probe;
- same-origin listing-site proof for `/`, `/support`, `/privacy`, and `/terms`, including restrictive CSP and no-redirect validation;
- reviewer walkthrough result;
- live ChatGPT desktop connection-card result;
- live ChatGPT mobile connection-card result;
- portal scan findings and resolutions.

A green local canary alone does not indicate production submission readiness. The zSSH repository intentionally does not own the VPS runner; live rollout evidence is produced through the dedicated zCloud VPS release lane so repository-scoped runner queues cannot masquerade as deployment proof.
