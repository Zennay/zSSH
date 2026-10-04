# Provider credential step scoping — 2026-10-04

## Scope

This note records an M5 GitHub Actions hardening decision for the protected Cloudflare DNS, Auth0 production-readiness, and aggregate OpenAI production-readiness workflows.

## Primary sources

- GitHub Actions secrets: https://docs.github.com/en/actions/concepts/security/secrets
- GitHub Actions workflow syntax (`jobs.<job_id>.steps[*].env`): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub Actions secure use / least privilege: https://docs.github.com/en/actions/reference/security/secure-use

GitHub documents that a secret is readable by a workflow only when the workflow explicitly references it, that environment secrets are read when the environment job starts, and that sensitive credentials should follow least-privilege handling. Step-level `env` limits a referenced secret to the step that needs it instead of every step in the job.

## zSSH decision

The production DNS and Auth0 workflows already fail closed on canonical protected-main provenance before provider operations. Their provider credentials must therefore not be referenced at job-level, because that makes the token part of the environment for checkout/setup/provenance steps that do not need it.

- `CLOUDFLARE_API_TOKEN` is referenced only by the three Cloudflare API steps: plan/read, apply, and verify/read.
- `AUTH0_MANAGEMENT_API_TOKEN` is referenced only by the Auth0 provider validation step in the dedicated Auth0 workflow.
- The aggregate OpenAI production-readiness audit keeps `CLOUDFLARE_API_TOKEN`, `AUTH0_MANAGEMENT_API_TOKEN`, `ZSSH_REVIEW_ACCESS_TOKEN`, and `OPENAI_APPS_CHALLENGE_TOKEN` out of job-level `env`; those four secrets are injected only into the single classifier step that converts their presence/validity into a secret-safe readiness receipt.
- Repository checkout, Node setup, canonical-main provenance, branch-protection checks, DNS convergence observation, summaries, issue synchronization, and artifact upload receive no provider/reviewer/challenge credential.
- Regression tests fail if these protected secrets return to the readiness job-level environment or disappear from the classifier step.

This does not change provider permissions, production targets, or the external-input gate. It narrows credential exposure inside already protected workflows.
