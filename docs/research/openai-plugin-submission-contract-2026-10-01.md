# OpenAI public plugin submission contract — 2026-10-01

## Purpose

This note records the current primary-source submission contract used to make zSSH review-ready. It is intentionally separate from the implementation so future workers can re-check the platform contract before changing package, authentication, tool metadata, or reviewer flows.

## Primary sources checked

- OpenAI — Upload and submit your plugin: https://developers.openai.com/plugins/deploy/submission
- OpenAI — Remote MCP server review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI — Authentication: https://developers.openai.com/plugins/build/auth
- OpenAI — Build an MCP server: https://developers.openai.com/plugins/build/mcp-server
- OpenAI — Define tools: https://developers.openai.com/plugins/plan/tools
- OpenAI — Plugin submission errors: https://developers.openai.com/plugins/deploy/submission-errors
- OpenAI — Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines

Checked on 2026-10-01. Re-check these sources before a portal submission or any change to the public MCP contract.

## Current submission contract

### Endpoint and distribution

- Public MCP submission needs a stable publicly reachable HTTPS endpoint using MCP streamable HTTP.
- A universal MCP server URL is the normal path. Template/workspace-specific MCP URLs are restricted and require an established trusted-developer relationship.
- Domain verification serves the exact portal challenge token as plain text at the portal-provided `/.well-known/openai-apps-challenge` URL.
- Changing a published MCP origin is materially different from a path-only/server update and can require a new plugin/review flow.

**zSSH decision:** target one stable universal public origin and keep per-user/per-target authorization behind OAuth + local pairing. Do not model each VPS as a separate template MCP origin.

### Identity, permissions, and data residency

- Publisher identity must be verified for the name used in the directory.
- Submission management requires the current apps-management permissions (documented as `api.apps.write` / `api.apps.read` in the review requirements).
- Projects with EU data residency cannot currently submit MCP-backed public plugins for review; use an eligible global-data-residency project.

**zSSH decision:** treat publisher verification/project residency as portal gates. Never encode a fake success state in repository release evidence.

### Authentication

- Customer-specific data and write actions require user authentication.
- Authenticated MCP servers are expected to follow OAuth 2.1 / MCP authorization semantics.
- The resource server must advertise protected-resource metadata and enforce access tokens/scopes.
- Authorization-server discovery must be usable for the review client; zSSH already validates issuer binding, authorization/token endpoints, authorization-code support, and PKCE S256.
- Reviewer access must work without inaccessible MFA, magic links, or private-network-only steps.

**zSSH decision:** OAuth identifies the caller; local target pairing remains a separate authorization boundary. A valid OAuth identity does not auto-approve a Linux target.

### Tool scan and metadata

The portal's **Scan Tools** step imports live MCP metadata including:

- names, titles, descriptions;
- input/output schemas;
- security schemes;
- `_meta`;
- annotations;
- linked UI/CSP metadata;
- MCP server instructions.

Tool annotations must match actual behavior. In particular, read-only, destructive, and open-world hints are not substitutes for server-side authorization.

**zSSH decision:** the public tool surface is fail-closed and separately reviewed. Generic shell/program-runner tools stay out of the public profile. The canonical public tool → OAuth scope map lives in `submission/public-tool-contract.json`.

### Package and review materials

For an initial MCP review:

- exactly five positive test cases are required;
- exactly three negative test cases are required;
- positive cases include the scenario/prompt, expected tool names, and observable expected result;
- a reviewer-accessible demo recording URL is required;
- release notes are required for the submission;
- website, support, privacy-policy, and terms URLs must be valid HTTPS URLs;
- reviewer credentials and sign-in instructions belong in the secure dashboard form, not in the public ZIP.

The package can import review cases and scalar review metadata into the portal. Imported test cases are package-managed/read-only in the dashboard, so stale package cases are a real release risk.

**zSSH decision:** the builder rejects unknown review tools, requires every public write tool to appear in a positive case, rejects reviewer credentials/instructions in the ZIP, requires release notes, and requires exactly one `zssh` streamable-HTTP MCP server.

### UI / CSP

- UI is optional, but any returned UI must declare the required CSP precisely.
- Plugins must work reliably in ChatGPT on desktop and mobile.
- Extra iframe/origin access increases review scope.

**zSSH decision:** keep the compact connection card same-origin/minimal, with no remote self-approval. Pairing approval remains local to the Linux target.

## Engineering evidence tied to this research

Canonical zSSH PR #30 / merge `1c204f43cc5af538973fc1c871ac90c63b947916` implements the package-side contract:

- shared reviewed public tool/scope contract;
- fail-closed review-case tool validation;
- public-write review coverage;
- no reviewer credentials/instructions in the public ZIP;
- release notes required;
- exactly one zSSH streamable-HTTP MCP server;
- negative regression canary in CI;
- reproducible plugin bundle validation.

Green canonical evidence:

- zSSH CI run `36941213967`;
- OpenAI public release gate run `36941213950`.

## Known external / unresolved gates

These are not safe to fabricate in source control:

1. stable production public HTTPS MCP URL;
2. production OAuth/IdP and reviewer test account;
3. reviewer access token/credentials entered through the secure portal flow;
4. OpenAI domain-verification challenge token from the portal;
5. reviewer-accessible demo recording URL;
6. verified publisher identity and eligible OpenAI project/data-residency selection;
7. final portal Scan Tools findings and manual review outcome.

The repository should automate every deterministic prerequisite around these gates, but a missing portal-issued token, real reviewer identity, or production credential remains an external dependency rather than something a worker should invent.

## Revisit triggers

Re-run this research before:

- changing MCP origin or universal/template URL strategy;
- adding/removing public tools;
- changing OAuth provider or scopes;
- adding iframe/remote UI origins;
- changing portable plugin schema/version;
- final submission after more than a short delay, because portal requirements can change.
