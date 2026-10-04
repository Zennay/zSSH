# Reviewed provider activations require exact current main — 2026-10-04

## Source check

GitHub documents that each workflow run is bound to the commit SHA and ref associated with the triggering event, and that `GITHUB_SHA` is the commit that triggered that workflow run:

- https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push

That means a reviewed push-marker run can remain queued or running after `main` has advanced to a newer commit.

## zSSH decision

The production DNS and Auth0 push-marker paths already required:

1. an exact reviewed marker value;
2. merged-PR provenance; and
3. live branch protection.

They now also require `check-main-protection.mjs --require-current-sha` before provider credentials are used. A stale workflow run for an older `main` revision therefore fails closed instead of mutating Cloudflare DNS or querying Auth0 with production credentials after canonical `main` has moved.

The manual provider paths already enforced this invariant. This change makes reviewed push-marker activation follow the same exact-current-main rule.
