# zSSH public plugin release checklist

## Release gate

This checklist tracks the production path from the current review-ready MCP profile to a public OpenAI plugin release.

## Pre-release

- [ ] `npm run repo:main-protection:status` reports GitHub `main` as protected; protected readiness and final release enforce this live prerequisite
- [ ] `main` rejects direct writes for normal user/automation paths, requires pull-request-based changes plus the zSSH CI/repository-hygiene check, and the canonical controlled direct-push canary is rejected; protected release workflows derive the governance attestation live from that immutable GitHub evidence
- [ ] Stable public HTTPS MCP endpoint configured
- [ ] Published `/privacy` page discloses data categories, purposes, recipients, retention, and user controls for the actual production data flow
- [ ] Production OAuth authorization server publishes discovery metadata with authorization-code flow, PKCE S256, and token endpoint auth methods
- [ ] OAuth discovery advertises a ChatGPT-compatible client identification path: CIMD (`client_id_metadata_document_supported: true`) or DCR (`registration_endpoint`)
- [ ] Resource-server metadata points to the production MCP resource
- [ ] Health, OAuth metadata, challenge, and unauthenticated MCP checks do not redirect away from the submitted origin
- [ ] `WWW-Authenticate` advertises the exact same-origin `/.well-known/oauth-protected-resource` URL
- [ ] Domain verification challenge is live
- [ ] Verify Domain is green for the exact production MCP origin; only then set `ZSSH_OPENAI_DOMAIN_VERIFIED=1` and `ZSSH_OPENAI_VERIFIED_MCP_ORIGIN=<scheme://hostname[:port]>`
- [ ] Reviewer account exists without private user data
- [ ] Dedicated reviewer credentials work at the exact public `ZSSH_REVIEW_LOGIN_URL` without MFA, email/SMS confirmation, magic links, private-network access, or operator approval; only then set `ZSSH_REVIEW_LOGIN_VERIFIED_URL` to that exact URL and `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1`
- [ ] Dedicated paired target fixture is available
- [ ] OpenAI Scan Tools is green for the exact production tool contract; set `ZSSH_OPENAI_TOOL_SCAN_VERIFIED=1` and `ZSSH_OPENAI_TOOL_SCAN_SHA256=<live tool_scan_sha256>` only after that exact scan
- [ ] Compute the current host-surface fingerprint with `ZSSH_PLUGIN_MCP_URL=<production /mcp URL> ZSSH_OPENAI_TOOL_SCAN_SHA256=<live tool_scan_sha256> node scripts/check-host-surface-review-binding.mjs --compute`
- [ ] Production connection card exercised successfully in ChatGPT desktop against that exact fingerprint; only then set `ZSSH_CHATGPT_DESKTOP_REVIEWED=1`
- [ ] Production connection card exercised successfully in ChatGPT mobile against that same exact fingerprint; only then set `ZSSH_CHATGPT_MOBILE_REVIEWED=1` and `ZSSH_CHATGPT_REVIEW_SHA256=<computed fingerprint>`

## Protected-environment readiness audit

Before attempting provider writes or the final production probe, run the manual `OpenAI production readiness audit` workflow (or `npm run release:readiness` with the equivalent environment locally). It emits only booleans, missing variable names, and ordered next actions; protected values are never serialized. The audit separates Cloudflare DNS inputs, Auth0 qualification inputs, reviewer-fixture inputs, and later OpenAI portal/live-host attestations so an incomplete stage does not masquerade as a transport or implementation failure.

## Canonical release provenance

Production submission is dispatched only from canonical `main`. Before the production environment is entered, the release gate verifies through GitHub's commit→pull-request association that the exact `GITHUB_SHA` is the merge commit of a closed, merged PR. Direct commits to `main` therefore cannot become production submission candidates. The separate `Canonical main provenance` workflow also checks every push to `main`.

That post-write provenance check is defense in depth, not a substitute for preventive repository policy. Final production dispatch first requires GitHub branch metadata to report `main` as protected. The protected workflows then verify the canonical rejected-direct-write evidence from issue #100, confirm the same-tree canary lineage into current `main`, and derive `ZSSH_MAIN_PROTECTION_VERIFIED=1` in-process. No persistent operator-set governance attestation is required.

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
- `main_protection_verified: true`, backed by the live immutable issue #100 rejected-direct-write proof and same-tree canary ancestry check;
- VPS rollout proof from the dedicated `Zennay/zCloud` `zSSH standalone VPS release` workflow, pinned to the exact canonical zSSH commit;
- SHA-256 fingerprint of the exact public tool metadata returned by the production probe, with `ZSSH_OPENAI_TOOL_SCAN_SHA256` required to match it exactly after the portal scan;
- SHA-256 of the exact `zssh-openai-plugin.zip` uploaded by the production release gate;
- plugin version, currently `0.1.2`, matching `package.json` and `submission/plugin.template.json`, with that exact version named in `publication.release_notes`;
- authorization-server metadata URL(s), issuer(s), and PKCE S256 evidence emitted by the production probe;
- same-origin listing-site proof for `/`, `/support`, `/privacy`, and `/terms`, including restrictive CSP and no-redirect validation;
- reviewer walkthrough result;
- exact `ZSSH_REVIEW_LOGIN_VERIFIED_URL` bound to the reviewer credentials test; changing the login URL requires a fresh credentials verification;
- live ChatGPT desktop connection-card result;
- live ChatGPT mobile connection-card result;
- `ZSSH_CHATGPT_REVIEW_SHA256` proving those two checks were performed against the exact production MCP origin/path, current tool contract, and committed connection-card HTML;
- portal scan findings and resolutions;
- exact MCP origin bound to the successful Verify Domain portal result.

A green local canary alone does not indicate production submission readiness. The zSSH repository intentionally does not own the VPS runner; live rollout and validate-only VPS evidence is produced through zCloud-owned workflows (including `zssh-public-gateway-vps-preflight.yml`) so repository-scoped runner queues cannot masquerade as deployment proof. zSSH CI/release workflows must remain GitHub-hosted and must not schedule `self-hosted` jobs.
