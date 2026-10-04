# OpenAI domain-verification origin evidence binding — 2026-10-04

## Primary-source refresh

OpenAI's current plugin submission documentation says a remote MCP submission needs a production HTTPS MCP server URL, a completed domain-verification challenge, and a successful current tool scan. The domain challenge is served at the portal-provided `/.well-known/openai-apps-challenge` URL, and the challenge base is an HTTPS origin on the MCP hostname or an eligible parent domain.

Sources checked 2026-10-04:

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors
- https://developers.openai.com/plugins/deploy/app-review

## zSSH invariant

`ZSSH_OPENAI_VERIFIED_MCP_ORIGIN` is the non-secret evidence binding for the production MCP origin whose Verify Domain step was completed. It is intentionally an origin, not an arbitrary URL.

The readiness classifier previously compared only `URL.origin` and required pathname `/`. That still accepted values such as:

- `https://zssh.cheapgpt.shop/?source=portal`
- `https://zssh.cheapgpt.shop/#verified`

Those values are not exact origin-only attestations even though their parsed origin matches the MCP endpoint.

## Engineering decision

Fail closed unless the attested value canonicalizes exactly to `${new URL(ZSSH_PLUGIN_MCP_URL).origin}/`. This rejects path, query, and fragment suffixes while preserving normal URL canonicalization of scheme, hostname, and default ports.

Regression coverage must prove that query- and fragment-suffixed attestations keep `portal_and_host_attestations` non-ready.
