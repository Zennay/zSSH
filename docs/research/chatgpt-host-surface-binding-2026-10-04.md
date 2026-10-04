# ChatGPT host-surface review binding — 2026-10-04

## Problem

The protected release gate already required manual desktop and mobile attestations after exercising the production zSSH connection card in ChatGPT. Those booleans did not identify *which* production surface had been reviewed.

That allowed stale evidence in principle: a successful review could remain marked green after changing the submitted MCP endpoint, the live tool contract, or the committed connection-card UI.

## Decision

Bind the manual ChatGPT desktop/mobile review to one deterministic SHA-256 covering:

- the exact production MCP origin and `/mcp` path;
- the exact production tool-contract SHA-256 that is also bound to OpenAI Scan Tools;
- the SHA-256 of the committed `ui/connection-card.html`.

`scripts/check-host-surface-review-binding.mjs --compute` emits this fingerprint. The protected environment stores it as `ZSSH_CHATGPT_REVIEW_SHA256` only after both the desktop and mobile checks have passed against that exact surface.

The production release gate recomputes the fingerprint and fails closed on endpoint, tool-contract, or UI drift. Release evidence records both the host-surface review fingerprint and the connection-card source fingerprint.

## Safety boundary

This fingerprint is non-secret evidence only. It does not fabricate or automate the actual ChatGPT desktop/mobile review, does not replace OpenAI review, and contains no credentials or access tokens.
