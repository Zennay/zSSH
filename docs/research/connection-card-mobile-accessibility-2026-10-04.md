# Connection card mobile/accessibility hardening — 2026-10-04

## Primary sources checked

- OpenAI Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines
- OpenAI Plugin UI guidelines: https://developers.openai.com/plugins/concepts/ui-guidelines
- OpenAI remote MCP review requirements: https://developers.openai.com/plugins/deploy/app-review

## Current contract

OpenAI's current guidance requires plugin UI to work reliably in ChatGPT on both desktop and mobile. Inline cards should stay lightweight and single-purpose, avoid nested scrolling, and keep primary actions to a maximum of two. The visual guidance also calls for platform-native typography, layouts that survive text resizing, and WCAG-AA-compatible accessibility.

The remote MCP review flow separately requires the production UI to be exercised on supported ChatGPT surfaces before submission. Automated checks therefore reduce regression risk but do not replace the final desktop/mobile reviewer-facing check.

## zSSH decision

Keep the connection UI as a single inline status card with one action: **Refresh status**. Do not add navigation, remote pairing approval, external assets, frames, fonts, or network origins.

Harden the existing card in-place:

1. make flex children explicitly shrinkable so long opaque profile/request IDs cannot force horizontal overflow;
2. add a narrow-card breakpoint that stacks status/details and makes the refresh action full-width;
3. use a 44px minimum button height for a safer mobile touch target;
4. keep system-font inheritance and avoid internal scrolling;
5. narrow live announcements to the status/note regions instead of marking the whole card live;
6. preserve the local-approval trust boundary and the existing empty external CSP.

Add a repository regression test that checks these structural invariants directly from the shipped HTML. The final ChatGPT desktop/mobile visual check remains a production release gate because only the real host surfaces can prove rendering and interaction end to end.

## Release implication

This closes an internal UI-hardening gap in M5 without fabricating external production inputs. It does **not** mark the plugin ready for submission: real DNS/TLS, production OAuth/reviewer credentials, portal Verify Domain + Scan Tools, demo recording, protected production values, and final live desktop/mobile review are still required.
