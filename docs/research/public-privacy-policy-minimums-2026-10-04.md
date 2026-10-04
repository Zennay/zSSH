# Public privacy policy minimums — 2026-10-04

## Primary sources checked

OpenAI's current plugin guidelines require a clear published privacy policy that explains, at minimum:

- categories of personal data collected;
- purposes of use;
- categories of recipients;
- data retention timelines;
- controls offered to users.

The remote MCP submission flow also requires a public HTTPS privacy-policy URL.

Sources checked on 2026-10-04 UTC:

- https://developers.openai.com/plugins/plugin-guidelines
- https://developers.openai.com/plugins/app-guidelines
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors

## Gap

The repository-level `PRIVACY.md` already covered these concepts, but the actual plugin listing points `privacyPolicyURL` to the same-origin production `/privacy` page. That public page described data handled, secrets, and target ownership, but did not explicitly disclose purposes, recipients, retention, or user controls.

A complete repository document is not sufficient if the published URL presented to directory users omits the required disclosures.

## Decision

The public `/privacy` page now explicitly documents:

1. data categories;
2. purpose;
3. recipients/data flow;
4. retention, including the 15-minute default pending-pairing TTL and operator-controlled pairing/audit retention;
5. user/operator controls;
6. secret-handling restrictions and the local target-ownership boundary.

The language remains aligned with the current architecture: zSSH does not claim that target data is never processed by the public gateway, does not claim a fixed retention period for owner-controlled records, and does not fabricate a future hosted retention policy.

## Regression coverage

`test/public-site.test.mjs` now fails if the published privacy page loses any of the five minimum disclosure sections or the core retention, recipient, revocation, and credential-handling statements.

If the production hosting, authentication, or data-flow model changes, both the page and these tests must be reviewed before release.
