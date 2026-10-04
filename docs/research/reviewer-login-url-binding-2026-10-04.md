# Reviewer login verification URL binding — 2026-10-04

## Problem

The public release gate required a dedicated reviewer login URL plus `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1`, but the boolean did not identify which login URL had actually been tested. A later login-path or host change could therefore leave stale credentials evidence marked green.

## Decision

The protected release environment now carries two URL values:

- `ZSSH_REVIEW_LOGIN_URL`: the current public reviewer login URL used for submission;
- `ZSSH_REVIEW_LOGIN_VERIFIED_URL`: the exact public URL at which the dedicated reviewer credentials were last successfully tested.

The release preflight normalizes both as public HTTPS URLs and requires their exact normalized `.href` values to match. `ZSSH_REVIEW_CREDENTIALS_VERIFIED=1` is valid only together with that exact URL binding.

Changing the reviewer-login host, port, path, query, or other URL component therefore requires a fresh real credentials test and an updated verified URL.

The reviewer login is also release-bound to the configured OAuth issuer: `ZSSH_REVIEW_LOGIN_URL` must use the exact same HTTPS origin as `ZSSH_OAUTH_ISSUER`. This prevents a stale or unrelated public login host from satisfying the reviewer-fixture gate while the production MCP server advertises a different authorization server. Paths may differ, so Auth0 Universal Login routes such as `/u/login` remain valid.

## Safety boundary

This stores only a public login URL and a non-secret boolean. Reviewer usernames, passwords, access tokens, MFA material, magic links, or other credentials remain outside the repository and release artifacts.
