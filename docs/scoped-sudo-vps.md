# Scoped sudo on a private zSSH VPS

## Why sudo failed on 19 October 2026

The private gateway ran as `ubuntu`, but its systemd user unit combined
`NoNewPrivileges=false` with `RestrictSUIDSGID=true`. The latter prevented
setuid privilege elevation for `/usr/bin/sudo`: `/proc/<gateway-pid>/status`
showed `NoNewPrivs: 1`, and `sudo -n -l` reported
`The "no new privileges" flag is set`. **This is not a reason to switch the
gateway to root or to give all workers administrator privileges.**

The reviewed private `deploy/zssh.service.in` now sets
`RestrictSUIDSGID=false` while leaving `NoNewPrivileges=false`. This permits
a **separately installed, exact-command sudoers policy** to operate. It does
not itself authorize any root commands. The public OAuth gateway and paired
agent keep their tighter sandbox defaults.

## One-time root authorization (VPS owner, not an AI worker)

Run only from a trusted root-capable VPS console or independently authorized
administrative SSH session. Do not use `docker` or setuid tricks to bypass
the current gateway's `NoNewPrivs` restriction.

1. Verify that the private zSSH instance is the intended target and the
   reviewed release is installed, and confirm the exact service unit names.
2. Apply a **minimal** policy. For read-only service inspection only:

   ```bash
   sudo bash /home/ubuntu/.local/share/zssh/current/deploy/install-scoped-sudo.sh \
     --user ubuntu \
     --inspect-service actions.runner.Zennay-zCloud.zcloud-vps-1.service \
     --inspect-service actions.runner.Zennay-Ftmo.vps-bb300bba-ftmo.service
   ```

   The installer requires real root, validates the policy with `visudo`,
   writes mode `0440` to `/etc/sudoers.d/for-zssh-ubuntu`, and rejects
   wildcard service names. It does not allow `sudo bash`, `sudo -i`,
   `sudo systemctl *`, or `NOPASSWD: ALL`.

3. Add **only** these non-secret allowlist settings to the private gateway
   `~/.config/zssh/gateway.env` (owned by the zSSH service account):

   ```ini
   ZSSH_SYSTEMD_INSPECT_SERVICES=actions.runner.Zennay-zCloud.zcloud-vps-1.service,actions.runner.Zennay-Ftmo.vps-bb300bba-ftmo.service
   ```

4. Install the reviewed zSSH release using the existing immutable deployment
   process. Confirm the installed user unit has
   `NoNewPrivileges=false` and `RestrictSUIDSGID=false`. Restart **only**
   `zssh.service` using `systemctl --user`, keeping an independent
   administrative recovery connection during the short restart.
5. Read back the restricted policy and test both exact commands; verify that
   `zssh_service_status` succeeds for allowlisted units and is rejected
   for an unrelated service:

   ```bash
   sudo -n -l
   sudo -n /usr/bin/systemctl is-active actions.runner.Zennay-zCloud.zcloud-vps-1.service
   sudo -n /usr/bin/systemctl status actions.runner.Zennay-zCloud.zcloud-vps-1.service --no-pager
   ```

   A `failed` or `inactive` **target service** is not evidence that zSSH
   lacks access; distinguish `systemctl`'s target-state exit code from
   `sudo: a password is required` or permission denials.

### Restart actions require a separate authorization

If a specific service requires restart access, the owner must explicitly
re-run the installer with that *exact* `--restart-service` capability and
update `ZSSH_SYSTEMD_RESTART_SERVICES` to match. Do not grant restart rights
for trading, broker, browser, worker, or database services as a default.
A service that is `failed` must be diagnosed before restart; never interrupt
a live `Runner.Worker`. zCloud listener recovery may need a separate
**start-if-inactive** capability rather than a restart grant.

## Keep runner identities separate

The FTMO GitHub runner uses a distinct `ftmo-runner` service account
(and was observed as `nobody` inside the worker context), while the zCloud
runner uses `ubuntu`. That isolation is intentional; changing all runners
to `ubuntu` or `root` expands the blast radius of arbitrary CI code.
Provision file ACLs and narrowly scoped service actions to the *specific*
runner that needs them instead.

**Acceptance:** non-root zSSH remains authenticated; `NoNewPrivs: 0` after
reviewed service restart; exactly allowlisted `sudo -n systemctl` operations
work; unauthorized commands still fail; no unscoped sudo privileges exist;
and no worker identities or production/trading gates are changed.
