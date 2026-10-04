# OpenAI public plugin contract research — 2026-10-02

Status: active engineering source for the zSSH public release. Re-check these primary sources before a release candidate is submitted because the plugin platform is evolving.

## Product terminology and distribution

As of 2026-07-09, OpenAI moved app discovery into the Plugin Directory. A plugin can include MCP-backed apps, skills, and templates. zSSH should therefore treat the public artifact as a **plugin package with a remote MCP server**, not as a legacy ChatGPT plugin manifest.

Primary sources:
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission

Engineering decision:
- Keep the existing MCP server as the capability layer.
- Ship a portable Agent Plugins package with root `plugin.json` and `mcp.json`.
- Keep the private operator profile separate from the public review profile.

## Public remote-MCP endpoint

Current public review requires a publicly accessible production HTTPS endpoint. The normal submission model is one universal MCP server URL that works for all users and organizations. Template URLs are reserved for trusted developers with an established OpenAI relationship.

Primary source:
- https://developers.openai.com/plugins/deploy/app-review

zSSH implication:
- Per-owner target agents remain self-hosted.
- Public distribution should converge on one stable zSSH connection/gateway endpoint.
- The gateway may broker identity, pairing, policy, and routing, but must not become a custody service for user SSH private keys.
- A target must remain independently revocable and should execute commands locally under an explicit Linux identity/policy.

Open architecture question for ADR:
- How does a universal gateway route a verified OAuth profile to one or more owner-controlled target agents while minimizing centrally stored metadata and keeping commands/results appropriately isolated?

## Publisher and project prerequisites

Before public submission:
- Complete individual or business identity verification for the publisher name.
- Use an OpenAI project with global data residency; projects with EU data residency currently cannot submit MCP-backed plugins for public review.
- The submitting principal needs `api.apps.write`; viewing draft/review state requires `api.apps.read`.

Primary source:
- https://developers.openai.com/plugins/deploy/app-review

These are portal/account gates. zSSH automation should prepare everything else and surface only the exact remaining portal action.

## OAuth 2.1 contract

Authenticated private data and write tools are expected to use MCP-compatible OAuth 2.1.

Required/relevant behavior:
- Resource server publishes protected-resource metadata.
- Authorization server publishes current authorization metadata.
- Authorization Code + PKCE with `S256`.
- Preserve the MCP `resource` parameter through authorization and token exchange.
- OpenAI clients may identify/register through CIMD, DCR, or a predefined OAuth client.
- Verify issuer, audience/resource, expiration, and scopes on every request.
- Advertise per-tool `securitySchemes` accurately.
- Return standards-based 401 / `WWW-Authenticate` challenges for invalid or insufficient tokens.

Primary sources:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/guides/security-privacy

zSSH decision:
- OAuth identifies the person/profile.
- OAuth alone never grants a Linux target. Local target pairing/revocation remains a second authorization boundary.

## Tool surface and annotations

The submission portal scans the live MCP server and stores metadata including tool names, descriptions, schemas, security schemes, annotations, UI metadata/CSP, and server instructions.

Rules:
- Annotation values must reflect real behavior; justification text does not override incorrect metadata.
- Public zSSH must not accidentally re-expose private generic executors.
- Read-only, destructive, idempotent, and open-world annotations must remain fail-closed and regression-tested.

Primary sources:
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/plugin-guidelines

## Connect website / UI direction

zSSH needs a small, calm connection website that makes the trust boundary understandable before the user grants access.

The website should provide:
- what zSSH connects and what stays on the target;
- account/OAuth connection state;
- target label and paired/unpaired state;
- pairing request and local approval instructions;
- effective capabilities, including whether any scoped sudo grants are present;
- revoke/disconnect;
- installation/bootstrap path;
- privacy, terms, and support links;
- clear loading/error/expired-pairing states;
- mobile and desktop usability.

Security constraints:
- Never place access tokens, SSH keys, sudo secrets, or capability credentials in page source, query strings, analytics, or logs.
- Use a restrictive CSP and explicit allowed origins.
- Pairing approval remains local to the owner-controlled target; the remote site must not be able to approve itself.

Primary sources:
- https://developers.openai.com/plugins/plugin-guidelines
- https://developers.openai.com/plugins/guides/security-privacy

## Scoped sudo

Public zSSH should support privileged maintenance only through explicit, owner-controlled capability grants.

Research/implementation rule:
- Prefer narrow commands/capabilities and generated policy over blanket `NOPASSWD: ALL`.
- Show the owner exactly what will become possible.
- Validate policy before install.
- Make grants reversible.
- Record grant/revoke audit events.
- Prove ungranted privileged actions fail.

The public MCP tool surface must remain capability-scoped even if the underlying target owner has chosen to grant zSSH narrowly-scoped sudo permissions.

## Package and review materials

Portable package:
- root `plugin.json` using the Agent Plugins schema;
- root `mcp.json` for remote Streamable HTTP MCP wiring;
- assets and optional skills as needed;
- OpenAI-specific presentation/review metadata under `extensions.com.openai`.

Initial MCP review requires:
- exactly **5 positive** review cases;
- exactly **3 negative** review cases;
- expected tools and observable expected behavior for positive cases;
- an accessible video walkthrough;
- release notes;
- reviewer credentials entered in the secure review form, not committed in the ZIP.

Reviewer account constraints:
- dedicated sample account/data;
- immediately usable;
- no inaccessible MFA, email/SMS code, magic link, or private-network dependency.

Primary sources:
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/submission

## Submission sequence

1. Deploy the final production HTTPS MCP endpoint.
2. Verify production OAuth and pairing with the reviewer fixture.
3. Build the deterministic plugin ZIP.
4. Add the MCP server in the submission portal and run **Scan Tools**.
5. Resolve required automated findings.
6. Complete listing metadata, privacy/support/legal URLs, localization, and review details.
7. Verify the domain challenge.
8. Run all five positive and three negative cases against the exact release.
9. Record the reviewer walkthrough.
10. Submit for review.
11. After approval, explicitly publish.

## zSSH release invariant

Every queue item that changes public architecture, authentication, authorization, sudo policy, website UX, or submission metadata must:

1. Research current primary sources first.
2. Record dated source URLs and the resulting decision in `docs/research/` or an ADR.
3. Implement the decision.
4. Add/adjust automated tests or release validators.
5. Produce deterministic evidence.

Research-only is not completion. Coding without research evidence is also not completion.


## Same-origin public listing website — 2026-10-02

Primary sources checked on 2026-10-02:
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/app-review
- https://developers.openai.com/plugins/deploy/submission-errors
- https://developers.openai.com/plugins/build/auth

Current platform facts:
- Remote MCP directory submissions require HTTPS `websiteURL`, `supportURL`, `privacyPolicyURL`, and `termsOfServiceURL`.
- The remote MCP endpoint must be publicly reachable; connection setup includes domain verification and a current tool scan.
- Public URLs used in the submission must be accessible and consistent with the submitted publisher.
- UI returned by an MCP server must use an explicit CSP for the origins it can access.
- Authenticated write/customer-specific tools must retain the OAuth 2.1 protected-resource and per-tool security contract.

Engineering decision:
- The canonical zSSH package no longer points its listing URLs at GitHub pages. The build derives all four listing URLs from the validated production MCP origin: `/`, `/support`, `/privacy`, and `/terms`.
- The public zSSH server serves those pages itself with no scripts, no forms, no analytics, no token-bearing URLs, and a restrictive CSP/referrer/permissions policy.
- The production submission probe treats those pages as release-critical infrastructure: no redirects, successful HTML response, expected zSSH content, and restrictive CSP are required before release evidence can be green.
- This same-origin policy is stricter than the minimum documented URL requirement by design. It reduces mutable external dependencies and makes publisher/product/domain review evidence easier to reason about.


## Reviewer credential readiness gate — 2026-10-04

Primary sources re-checked on 2026-10-04:
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/app-review

Current platform facts:
- Remote MCP review requires reviewer credentials that work without MFA, email confirmation, SMS confirmation, or private-network access.
- For authenticated servers, the review team must be able to log into a demo account with no additional operator configuration.
- Reviewer credentials belong in the secure Review details form, not in the plugin package.

Engineering decision:
- The automated bearer token used by zSSH's production probe is not sufficient evidence that the human reviewer login is ready.
- The `openai-production` release gate therefore also requires a public HTTPS `ZSSH_REVIEW_LOGIN_URL` and an explicit `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1` attestation.
- The attestation may only be set after the dedicated reviewer login has been tested from outside the private network without MFA, email/SMS codes, magic links, or operator approval.
- No username, password, access token, or other reviewer credential is written to the repository or uploaded as release evidence. Green evidence records only the public login origin/path and the boolean verification state.


## Demo recording accessibility proof — 2026-10-04

Primary source re-checked on 2026-10-04:
- https://developers.openai.com/plugins/deploy/submission

Current platform fact:
- Initial MCP review requires a reviewer-accessible video walkthrough URL.

Engineering decision:
- URL syntax alone is not sufficient release evidence. The production submission probe must anonymously reach the configured demo recording URL from GitHub-hosted CI before release evidence can be green.
- Ordinary HTTPS redirects are allowed because common reviewer-facing video hosts redirect to a playback page or CDN. The final resolved location must still be HTTPS and public in production mode.
- The probe sends no OAuth bearer token, reviewer credential, cookie, or query-injected secret to the demo host.
- The probe requests only enough content to prove reachability and cancels the response body instead of downloading the recording.
- Release evidence records only the resolved demo origin/path and content type, not credentials or private query values.
