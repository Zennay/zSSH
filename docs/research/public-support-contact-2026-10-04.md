# Public support contact requirement — 2026-10-04

## Primary sources

- https://developers.openai.com/plugins/plugin-guidelines
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors

## Current platform requirement

OpenAI's current Plugin guidelines require published plugins to provide customer-support contact details that end users can actually use. Remote MCP submissions also require a valid HTTPS `supportURL`.

## Gap found in zSSH

The plugin package already pointed `supportURL` at the same-origin production `/support` page, but that page only linked to the repository homepage. The repository-level `SUPPORT.md` documented a GitHub Issues route, while the public page did not expose that direct end-user route or a direct private security-reporting route.

## Engineering decision

The production `/support` page must expose:

1. a direct public support route: `https://github.com/Zennay/zSSH/issues`;
2. a direct private vulnerability-reporting route: `https://github.com/Zennay/zSSH/security/advisories/new`;
3. an explicit warning not to post credentials, capability URLs, or exploit details in public issues.

Regression tests pin these routes so a future copy change cannot silently reduce the published support page to a non-actionable repository homepage.

This is release hardening only. It does not fabricate the remaining external M5 inputs such as production DNS/TLS, OAuth reviewer credentials, OpenAI portal verification, demo recording, or live ChatGPT desktop/mobile review.
