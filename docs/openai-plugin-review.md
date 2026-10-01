# OpenAI public plugin review readiness

Updated: 2026-10-01

This document tracks zSSH against the current OpenAI public plugin requirements without weakening the existing private/self-hosted workflow.

## Implemented

- Streamable HTTP MCP endpoint.
- Explicit `readOnlyHint`, `destructiveHint`, and `openWorldHint` annotations on every exposed tool.
- Public plugin profile: `ZSSH_PLUGIN_PROFILE=public`.
- Public profile does not advertise `zssh_exec` or `zssh_run_safe`.
- Public profile exposes narrow read-only system tools instead of a generic command selector.
- Public profile refuses startup when `ZSSH_EXEC_MODE=full`.
- File access remains bounded to configured allowed roots.
- File writes are explicitly annotated as destructive.
- Non-root startup guard, timeouts, output limits, secret redaction, and audit logging.
- `/.well-known/openai-apps-challenge` exact-token response via `OPENAI_APPS_CHALLENGE_TOKEN`.
- Runtime CI canary verifies the public tool surface, annotations, fail-closed raw-shell state, and domain challenge.
- Privacy, terms, and support documents are present in the repository.

## Public profile tool surface

Read-only:
- `zssh_server_info`
- `zssh_read_file`
- `get_system_uptime`
- `get_system_identity`
- `get_kernel_info`
- `get_disk_usage`
- `get_memory_usage`

Write:
- `zssh_write_file`

The private profile keeps the existing trusted-operator tools, including the safe program runner and optional raw shell, so the current private zSSH workflow is not broken.

## Still required before public directory submission

### 1. OAuth 2.1 for public user authentication

OpenAI's published MCP authentication guidance expects OAuth 2.1 for servers that expose private user data or take actions. zSSH's current capability URL, static key, and development bearer-token modes are appropriate for private/test deployments, not the intended public-directory authentication path.

The public path needs:
- MCP protected-resource metadata;
- authorization-server metadata;
- Authorization Code + PKCE (S256);
- access-token verification including issuer, audience, expiry, and scopes;
- OpenID/email support if workspace domain restrictions are required;
- a reviewer account that works without inaccessible MFA or magic-link steps.

Do not remove the current private authentication modes while adding this.

### 2. Production endpoint model

OpenAI normally expects one stable public HTTPS MCP endpoint. zSSH's preferred architecture is user-owned/self-hosted execution. Public submission therefore needs one of these product decisions:

- a universal zSSH control-plane endpoint that authenticates users and routes only to their paired agents while execution remains on each user's machine; or
- OpenAI approval for a template MCP URL model for per-user/per-workspace endpoints.

Do not silently convert zSSH into a service that stores user SSH private keys or executes on a shared zSSH-owned Linux host.

### 3. Pairing and revocation

Before public launch, users need an explicit way to pair a target, see which target/account is connected, and revoke that pairing without editing server files manually.

### 4. Review package

Once the production endpoint and OAuth flow exist, add the final OpenAI plugin package metadata with:
- product website;
- support URL;
- privacy policy URL;
- terms URL;
- up to three starter prompts;
- five positive review cases;
- three negative review cases;
- release notes;
- reviewer credentials entered separately in the submission portal.

## Local/public-profile test

Use production-safe settings:

```bash
NODE_ENV=production \
ZSSH_PLUGIN_PROFILE=public \
ZSSH_EXEC_MODE=disabled \
ZSSH_DEV_BEARER_TOKEN='<development-only-token>' \
ZSSH_ALLOWED_ROOTS='/safe/test/root' \
node server.mjs
```

Then run:

```bash
node public-plugin-canary.mjs
```

The public canary must fail if the generic raw-shell/program tools appear in the scan or if required annotations are missing.
