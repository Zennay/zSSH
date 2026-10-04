# Protected readiness secret step scope — 2026-10-04

## Problem

The protected `OpenAI production readiness audit` job entered the `openai-production` environment and bound four production secrets at job scope:

- `CLOUDFLARE_API_TOKEN`
- `ZSSH_REVIEW_ACCESS_TOKEN`
- `AUTH0_MANAGEMENT_API_TOKEN`
- `OPENAI_APPS_CHALLENGE_TOKEN`

Only `scripts/check-production-readiness-audit.mjs` needs those values, and only to classify whether required protected inputs are present and valid. Job-level bindings unnecessarily made the secrets available to checkout, Node setup, summary generation, issue synchronization, and artifact upload steps.

## Primary sources

- GitHub Secure use reference: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub Using secrets in Actions: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- GitHub Deployments and environments: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

GitHub recommends least-privilege credential use, documents step-level `env` secret injection, and notes that environment secrets become available to jobs that reference the protected environment.

## Decision

Keep the protected `openai-production` environment on the audit job because the readiness classifier must inspect protected inputs, but bind the four production secrets only on the `Build secret-safe readiness receipt` step.

Non-secret configuration and derived governance/public-origin state may remain at job scope because later summary and synchronization steps consume the sanitized receipt, not the original protected values.

## Regression contract

`test/production-readiness-audit.test.mjs` now fails if any of the four production secret bindings:

1. returns to the audit job header, or
2. is missing from the receipt-builder step.

The test also proves later readiness steps do not reference those protected bindings.

## M5 implication

This is release hardening only. It narrows secret exposure without weakening readiness classification, changing the public tool surface, bypassing protected-environment controls, or fabricating the still-missing Cloudflare credential. The active live gate remains `dns_publication`.
