# OpenAI submission package

This directory contains the source templates for the zSSH Agent Plugins submission package.

## Build

A final submission build deliberately requires three external, production-specific inputs:

- `ZSSH_PLUGIN_MCP_URL`: the stable public HTTPS URL ending in `/mcp`.
- `ZSSH_PLUGIN_DEMO_RECORDING_URL`: a reviewer-accessible HTTPS walkthrough video.
- `ZSSH_PLUGIN_ICON`: a square SVG or PNG icon at least 48×48.

Example:

```bash
ZSSH_PLUGIN_MCP_URL=https://mcp.example.com/mcp \
ZSSH_PLUGIN_DEMO_RECORDING_URL=https://example.com/review/zssh-demo \
ZSSH_PLUGIN_ICON=./brand/zssh.svg \
npm run plugin:build
```

The builder writes `dist/openai-plugin/plugin.json`, `dist/openai-plugin/mcp.json`, the packaged icon, and `dist/zssh-openai-plugin.zip`.

It fails before producing a ZIP when listing limits, URL requirements, icon dimensions, starter prompts, or the required review-case counts do not pass.

## Included review material

The manifest contains exactly five positive and three negative initial MCP review cases. Reviewer credentials are intentionally not stored in this repository or ZIP; OpenAI requires those to be entered separately in the secure review form.

The annotation explanations to paste into review are maintained in `docs/openai-annotation-justifications.md`.

## Reviewer target fixture

The review cases assume the dedicated review target has `/srv/zssh-review` configured as `ZSSH_PUBLIC_ALLOWED_ROOTS`, with a UTF-8 file at `/srv/zssh-review/sample.txt`. Keep this public root free of credentials and authentication secrets. The public file tools reject common credential-file paths and secret-like content rather than returning it. The reviewer OAuth account must be explicitly paired to that target before target operations are expected to succeed.

The final directory submission also needs a verified developer identity, successful domain verification, a current production tool scan, and reviewer-accessible OAuth credentials. The protected `openai-production` release environment must keep `ZSSH_OPENAI_DOMAIN_VERIFIED=1`, `ZSSH_OPENAI_DOMAIN_VERIFIED_HOST`, and `ZSSH_OPENAI_TOOL_SCAN_VERIFIED=1` unset until those portal checks are actually green. The verified host must be the exact challenge-base hostname shown by OpenAI: either the production MCP hostname or an eligible parent domain accepted by the portal.

## Reviewer account release gate

OpenAI review requires a dedicated demo account that works immediately for the reviewer. Before setting `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1`, verify that the reviewer can use `ZSSH_REVIEW_LOGIN_URL` from the public internet without MFA, email/SMS confirmation, magic links, private-network access, or any operator approval step.

The username/password or other reviewer credentials must **not** be committed, placed in the plugin ZIP, printed by CI, or stored in release artifacts. Enter those credentials only in the secure Review details form. The GitHub release environment stores only:

- `ZSSH_REVIEW_LOGIN_URL` as a non-secret variable;
- `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1` as a non-secret operator attestation after the login has actually been tested;
- `ZSSH_CHATGPT_DESKTOP_REVIEWED=1` only after the production connection card has been exercised successfully in ChatGPT desktop;
- `ZSSH_CHATGPT_MOBILE_REVIEWED=1` only after the production connection card has been exercised successfully in ChatGPT mobile;
- `ZSSH_REVIEW_ACCESS_TOKEN` separately as a secret used only by the automated end-to-end MCP probe;
- `ZSSH_OPENAI_DOMAIN_VERIFIED=1` only after OpenAI Verify Domain succeeds;
- `ZSSH_OPENAI_DOMAIN_VERIFIED_HOST` set to the exact hostname used by that successful OpenAI domain challenge; the release gate rejects an unrelated host;
- `ZSSH_OPENAI_TOOL_SCAN_VERIFIED=1` only after the current production Scan Tools run succeeds and required findings are resolved.
- `ZSSH_OPENAI_TOOL_SCAN_SHA256` set to the exact lowercase SHA-256 emitted by the production probe for the tool contract that was scanned; any later tool-contract change requires a fresh portal scan and a refreshed fingerprint.

## Production readiness probe

After the public OAuth endpoint, reviewer account, pairing, review fixture, and OpenAI domain challenge are configured, run:

```bash
ZSSH_PLUGIN_MCP_URL=https://mcp.example.com/mcp \
ZSSH_REVIEW_ACCESS_TOKEN='<short-lived reviewer access token>' \
ZSSH_REVIEW_LOGIN_URL=https://auth.example.com/login \
ZSSH_REVIEW_CREDENTIALS_VERIFIED=1 \
ZSSH_CHATGPT_DESKTOP_REVIEWED=1 \
ZSSH_CHATGPT_MOBILE_REVIEWED=1 \
ZSSH_REVIEW_FILE=/srv/zssh-review/sample.txt \
ZSSH_REVIEW_WRITE_FILE=/srv/zssh-review/output.txt \
OPENAI_APPS_CHALLENGE_TOKEN='<current dashboard challenge token>' \
npm run submission:probe
```

The probe verifies the live health endpoint, reviewer-accessible demo recording URL from a public CI runner, RFC 9728 resource metadata, unauthenticated 401/WWW-Authenticate behavior, public tool scan, required annotations and OAuth schemes, absence of generic executors, profile and pairing state, minimized public metadata, read-only system tools, and the reviewer file read/write roundtrip. The demo check follows ordinary HTTPS redirects but never sends the reviewer access token to the recording host. It never prints the access token.
