# ChatGPT-compatible OAuth token endpoint authentication methods — 2026-10-04

## Primary source

- OpenAI Plugins authentication: https://developers.openai.com/plugins/build/auth

## Current contract

OpenAI's current plugin authentication documentation requires an OAuth 2.1 authorization server to publish `token_endpoint_auth_methods_supported`. ChatGPT's CIMD client can use `none` or `private_key_jwt`. For other supported OAuth client-registration paths, the documented common methods are `none`, `client_secret_post`, and `client_secret_basic`.

OpenAI also states that ChatGPT cannot present customer-provided mTLS credentials. An authorization server that publishes only methods such as `tls_client_auth` or `self_signed_tls_client_auth` can therefore satisfy the metadata-shape requirement while still having no documented token-authentication path ChatGPT can actually use.

## Engineering decision

The zSSH release contract must fail closed unless the authorization-server metadata advertises at least one currently documented ChatGPT-compatible token endpoint authentication method:

- `none`
- `private_key_jwt`
- `client_secret_post`
- `client_secret_basic`

This is a compatibility gate, not a preference ordering. Existing PKCE, issuer, endpoint-binding, CIMD/DCR and Auth0 production checks remain unchanged.

## Safety and rollout

This change performs no provider mutation and adds no OAuth scope. It prevents a false-green production readiness result for an authorization server whose token endpoint cannot authenticate a ChatGPT OAuth client using any currently documented method.
