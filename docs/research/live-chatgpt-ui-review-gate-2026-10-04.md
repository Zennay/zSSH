# Live ChatGPT desktop/mobile review gate — 2026-10-04

## Primary sources checked

- OpenAI Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines
- OpenAI Plugin UI guidelines: https://developers.openai.com/plugins/concepts/ui-guidelines
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review
- OpenAI plugin submission flow: https://developers.openai.com/plugins/deploy/submission

## Current contract

OpenAI's current plugin guidelines require published plugins, including optional UI, to function reliably in ChatGPT on both desktop and mobile. The UI guidance keeps inline cards lightweight, single-purpose, accessible, and free of nested scrolling. The review flow still requires the production integration to be tested as the reviewer will actually encounter it; repository-only structural tests cannot prove real ChatGPT host rendering or interaction.

## zSSH decision

The repository already contains automated structural coverage for the compact connection card, but M5 must not call the public release ready solely from those tests.

The protected `openai-production` environment therefore gains two non-secret operator attestations:

- `ZSSH_CHATGPT_DESKTOP_REVIEWED=1`
- `ZSSH_CHATGPT_MOBILE_REVIEWED=1`

Both remain unset until the exact production connection card has been exercised successfully in the corresponding ChatGPT host surface. The release preflight and final evidence generation fail closed unless both values are exactly `1`.

These attestations do not fabricate visual proof and do not replace OpenAI review. They prevent an otherwise-green production workflow from omitting the final host-surface check that the project already treats as mandatory.

## Evidence boundary

Green release evidence may record only the booleans that desktop and mobile review passed. Screenshots, reviewer credentials, user content, access tokens, or private target data are not required in the release artifact.

The remaining external release gates are unchanged: real public DNS/TLS, production OAuth/OIDC and reviewer account, real demo recording, OpenAI Verify Domain and current Scan Tools completion, protected production configuration, and final portal submission.
