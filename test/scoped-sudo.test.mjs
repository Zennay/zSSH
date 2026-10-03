import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validScopedServiceName } from "../server.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELPER = path.join(ROOT, "deploy", "zssh-sudo-helper");
const INSTALLER = path.join(ROOT, "deploy", "install-sudo-capabilities.sh");

test("scoped sudo service identifiers are narrow and traversal-safe", () => {
  for (const service of ["nginx.service", "zssh@worker-1.service", "docker.service", "my_app.service"]) {
    assert.equal(validScopedServiceName(service), true, service);
    const result = spawnSync("bash", [HELPER, "validate-name", service], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const service of ["-evil.service", "../ssh.service", "nginx.service extra", "foo/bar.service", "", "a".repeat(129)]) {
    assert.equal(validScopedServiceName(service), false, service);
    const result = spawnSync("bash", [HELPER, "validate-name", service], { encoding: "utf8" });
    assert.notEqual(result.status, 0, service);
  }
});

test("scoped sudo helper and installer keep root boundary fixed", async () => {
  const helper = await readFile(HELPER, "utf8");
  const installer = await readFile(INSTALLER, "utf8");

  assert.match(helper, /CONFIG="\/etc\/zssh\/sudo-services"/);
  assert.match(helper, /SYSTEMCTL="\/usr\/bin\/systemctl"/);
  assert.match(helper, /exec \/usr\/bin\/env -i/);
  assert.match(helper, /service is not granted to zSSH/);
  assert.doesNotMatch(helper, /\beval\b|bash -c|sh -c/);

  assert.match(installer, /ZSSH_SERVICE_USER/);
  assert.match(installer, /ZSSH_SUDO_ALLOWED_SERVICES/);
  assert.match(installer, /NOPASSWD:NOSETENV: \/usr\/local\/libexec\/zssh-sudo/);
  assert.match(installer, /visudo/);
  assert.match(installer, /-o root -g root -m 0755/);
  assert.match(installer, /-o root -g root -m 0440/);
  assert.doesNotMatch(installer, /ALL=\(root\)\s+ALL|\/bin\/bash|\/bin\/sh/);
});
