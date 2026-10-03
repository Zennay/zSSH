# Bounded Git and systemd operations — 2026-10-03

## Scope

This change replaces common private-profile raw-shell tasks with explicit Git and systemd capabilities while preserving the existing public OpenAI tool contract.

## Primary sources

- Git `git pull` documentation, checked 2026-10-03:
  https://git-scm.com/docs/git-pull
- Existing zSSH scoped-sudo decision and upstream sudoers references:
  `docs/research/scoped-sudo-grants-2026-10-03.md`

## Facts used

1. `git pull --ff-only` refuses integration when local and remote history have diverged; it does not create a merge commit in that case.
2. zSSH's scoped sudo policy grants only fully-qualified `systemctl` commands with exact service names and exact arguments.
3. The public plugin release gate fingerprints an exact reviewed tool set, so adding operational tools there would be a separate review-surface decision.

## Decision

- Add fixed-argv Git status and fast-forward-only pull to the private/self-hosted profile.
- Constrain repository paths through the existing real-path `ZSSH_ALLOWED_ROOTS` boundary.
- Add fixed-argv system-service status and restart tools to the private/self-hosted profile.
- Require exact `.service` names configured separately for inspect and restart; restart implies inspect.
- Execute system service actions only as `sudo -n <absolute-systemctl> <exact-action> <exact-unit> ...`, matching the scoped-sudo installer contract.
- Keep all four tools out of the public profile for now so the OpenAI review fingerprint and OAuth scope contract do not expand implicitly.
- Keep raw shell disabled by default; these capabilities are the preferred route for routine operations.
