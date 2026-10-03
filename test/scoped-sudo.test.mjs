import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderScopedSudoers,
  validateServiceUnit,
  validateServiceUser,
  validateSystemctlPath,
} from "../scripts/render-scoped-sudoers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

test("renders only exact scoped systemd commands", () => {
  const text = renderScopedSudoers({
    user: "zssh",
    inspectServices: ["nginx.service"],
    restartServices: ["my-app.service"],
    systemctlPath: "/usr/bin/systemctl",
  });

  assert.match(text, /\/usr\/bin\/systemctl status nginx\.service --no-pager/);
  assert.match(text, /\/usr\/bin\/systemctl is-active nginx\.service/);
  assert.match(text, /\/usr\/bin\/systemctl status my-app\.service --no-pager/);
  assert.match(text, /\/usr\/bin\/systemctl restart my-app\.service/);
  assert.match(text, /zssh ALL=\(root\) NOPASSWD: NOSETENV:/);
  assert.doesNotMatch(text, /NOPASSWD:\s*ALL/);
  assert.doesNotMatch(text, /[?*\[\]]/);
  assert.doesNotMatch(text, /\/bin\/(?:ba)?sh/);
});

test("rejects wildcard, injected, and path-like service grants", () => {
  for (const value of [
    "*.service",
    "nginx.service --now",
    "../../nginx.service",
    "nginx",
    "nginx.service;sh",
    "nginx service.service",
  ]) {
    assert.throws(() => validateServiceUnit(value));
  }
});

test("rejects unsafe service users and systemctl paths", () => {
  assert.throws(() => validateServiceUser("root ALL=(ALL)"));
  assert.throws(() => validateServiceUser("../zssh"));
  assert.throws(() => validateSystemctlPath("systemctl"));
  assert.throws(() => validateSystemctlPath("/usr/bin/systemctl;sh"));
  assert.equal(validateSystemctlPath("/usr/bin/systemctl"), "/usr/bin/systemctl");
});

test("requires an explicit capability", () => {
  assert.throws(() => renderScopedSudoers({ user: "zssh" }), /at least one/);
});

test("root installer validates before installing and refuses broad grants", async () => {
  const text = await readFile(path.join(ROOT, "deploy", "install-scoped-sudo.sh"), "utf8");
  assert.match(text, /id -u/);
  assert.match(text, /visudo/);
  assert.match(text, /-cf "\$TMP"/);
  assert.match(text, /install -o root -g root -m 0440/);
  assert.match(text, /\/etc\/sudoers\.d\/for-zssh-/);
  assert.match(text, /-L "\$TARGET"/);
  assert.doesNotMatch(text, /NOPASSWD:\s*ALL/);
  assert.doesNotMatch(text, /(?:bash|sh) -c/);
});
