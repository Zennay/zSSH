# Scoped sudo capability grants — 2026-10-03

## Scope

zSSH needs an opt-in way to grant a dedicated unprivileged service account a very small set of root-level service-management capabilities without turning the MCP process into a general root shell.

This decision covers only sudoers policy generation and installation. It does not widen the public MCP tool surface by itself.

## Primary sources checked

- sudoers(5), upstream-derived Linux manual, retrieved 2026-10-03:
  https://man7.org/linux/man-pages/man5/sudoers.5.html
- sudoers manual, sudo project:
  https://www.sudo.ws/docs/man/1.9.14/sudoers.man.pdf

## Relevant facts

1. A sudoers command should use a fully qualified executable path.
2. If a sudoers command omits command-line arguments, the permitted user may run that executable with arbitrary arguments.
3. Shell-style wildcards in command arguments can match across word boundaries and therefore create surprising privilege expansion.
4. `NOPASSWD` is a per-command policy tag; it must not be treated as permission to grant a general shell or all commands.

## Decision

zSSH scoped-sudo policy is generated from explicit capabilities:

- an exact service unit name;
- an exact action;
- an exact absolute `systemctl` path.

The generated policy never emits:

- `NOPASSWD: ALL`;
- a shell interpreter;
- a directory command grant;
- wildcard service names;
- wildcard command arguments;
- argument-less `systemctl` permission.

The first supported capabilities are:

- inspect a named `.service` unit with exact `status ... --no-pager` and `is-active ...` commands;
- restart a named `.service` unit with exact `restart ...` command.

Restart permission is opt-in separately from inspection permission.

## Installation boundary

The renderer is unprivileged and only writes policy text to stdout. The installer must be run explicitly as root, validates the candidate with `visudo -cf`, refuses a symlink destination, installs mode `0440` under `/etc/sudoers.d/for-zssh-<user>`, and validates the installed file again.

This preserves the operating system as the privilege boundary and keeps ChatGPT/MCP input out of sudoers policy construction.
