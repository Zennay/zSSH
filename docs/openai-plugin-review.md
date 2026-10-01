# OpenAI public plugin readiness

Updated: 2026-10-01

zSSH has two deliberately separate surfaces:

- **Private operator mode** keeps the powerful owner-operated tools.
- **Public plugin mode** exposes only the narrow tool set that is suitable for a ChatGPT directory review.

The public profile is the submission candidate. It must stay useful without the optional UI and must never inherit raw shell execution from private mode.

## What is already in place

The public profile currently has:

- a Streamable HTTP MCP endpoint;
- OAuth 2.1 resource-server discovery and JWT verification;
- separate `zssh:read` and `zssh:write` scopes;
- target pairing and immediate local revocation;
- no `zssh_exec` or generic program runner in the public tool scan;
- explicit `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations;
- a separate explicit `ZSSH_PUBLIC_ALLOWED_ROOTS` boundary for the public profile; production public mode will not reuse broad private roots;
- public file tools reject credential-like paths and content instead of treating secret redaction as sufficient;
- bounded filesystem roots and atomic text-file writes;
- non-root startup, command timeouts, output limits, secret redaction, and JSONL audit logging;
- exact OpenAI domain-challenge handling at `/.well-known/openai-apps-challenge`;
- a deterministic reviewer fixture and an end-to-end production submission probe;
- a machine-validated Agent Plugins ZIP with five positive and three negative review cases;
- privacy, terms, support, and annotation-justification documents.

## Connector UI

The only public UI is a compact connection card attached to `get_pairing_status`.

It shows:

- the human-readable Linux target label;
- the opaque zSSH profile ID;
- whether the profile is connected, waiting for approval, or not paired;
- the short-lived pairing request ID when one exists.

The component has no external scripts, fonts, images, frames, or network origins. Its CSP therefore declares empty external allowlists.

Pairing approval is intentionally **not** available in the ChatGPT component. Approval stays local to the Linux target, so a remote ChatGPT session cannot grant itself access. The MCP tools remain fully usable in clients that do not render UI.

## Public tool surface

Read-only:

- `zssh_server_info`
- `get_profile`
- `zssh_read_file`
- `get_system_uptime`
- `get_system_identity`
- `get_kernel_info`
- `get_disk_usage`
- `get_memory_usage`

State-changing but non-destructive:

- `get_pairing_status` — may create a short-lived pairing request, but cannot approve it.

Write:

- `zssh_write_file` — creates or atomically replaces a UTF-8 file inside an operator-configured root.

The private profile keeps the existing trusted-operator tools and is not part of the public submission scan.

## Remaining gates before directory submission

### 1. Production OAuth login

The zSSH resource-server half is implemented. The production submission still needs an authorization server / identity provider that:

- publishes current OAuth authorization-server metadata;
- supports Authorization Code + PKCE (S256);
- supports ChatGPT client identification through the current supported mechanism;
- preserves the exact MCP resource during authorization and token exchange;
- issues access tokens for the zSSH MCP audience and scopes;
- provides a dedicated reviewer account that does not depend on inaccessible MFA, a magic link, or a real user's data.

Do not implement a custom password database inside zSSH just to satisfy this gate.

### 2. Endpoint model for a public directory listing

OpenAI normally expects one stable public HTTPS MCP endpoint.

zSSH is intentionally self-hosted, so each owner naturally has a different target endpoint. OpenAI supports template MCP URLs only for trusted developers with an established relationship. Until that route is explicitly available, the public product needs a universal endpoint model for ordinary directory distribution.

A universal zSSH endpoint may broker identity and pairing, but it must not become a store for users' SSH private keys and should keep execution on the user's paired target.

### 3. Reviewer-accessible production setup

Before pressing Submit:

- deploy the current public profile to a stable HTTPS endpoint;
- complete developer/business identity verification in the OpenAI Platform Dashboard;
- use a project with global data residency for the MCP submission;
- complete the live domain-verification challenge;
- connect the production OAuth reviewer account and pair it to the dedicated sample target;
- run `npm run submission:probe` against that production endpoint;
- scan the latest tools in the submission portal and resolve every required finding;
- record the required reviewer walkthrough;
- check the compact connection card on both ChatGPT desktop and mobile;
- build the final ZIP and submit the current five positive and three negative cases.

## Production probe

After the endpoint, reviewer account, pairing, fixture, and domain challenge are live:

```bash
ZSSH_PLUGIN_MCP_URL=https://mcp.example.com/mcp \
ZSSH_REVIEW_ACCESS_TOKEN='<short-lived reviewer access token>' \
ZSSH_REVIEW_FILE=/srv/zssh-review/sample.txt \
ZSSH_REVIEW_WRITE_FILE=/srv/zssh-review/output.txt \
OPENAI_APPS_CHALLENGE_TOKEN='<current dashboard challenge token>' \
npm run submission:probe
```

The probe checks the health endpoint, OAuth protected-resource metadata, unauthenticated challenge behavior, tool scan, OAuth schemes, annotations, absence of generic executors, profile and pairing state, public metadata minimization, read-only system tools, and the reviewer file read/write roundtrip. It never prints the access token.

## Release rule

A green local or CI canary is not enough to call the plugin submitted or accepted. Submission readiness requires the production endpoint, production OAuth flow, current portal scan, reviewer credentials, domain verification, and reviewer-facing test cases to be green together.
