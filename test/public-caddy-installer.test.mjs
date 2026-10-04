import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-caddy-install-"));
  const fakeBin = path.join(root, "bin");
  const etcCaddy = path.join(root, "etc-caddy");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(etcCaddy, { recursive: true });

  const caddyfile = path.join(etcCaddy, "Caddyfile");
  const snippet = path.join(etcCaddy, "zssh-public.caddy");
  const systemctlLog = path.join(root, "systemctl.log");
  const reloadCounter = path.join(root, "reload-counter");
  const original = '{\n\temail ops@example.dev\n}\n\nlegacy.example.dev {\n\trespond "ok"\n}\n';
  await writeFile(caddyfile, original);

  await writeFile(path.join(fakeBin, "sudo"), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${1:-}" == "-n" ]]; then shift; fi
exec "$@"
`, { mode: 0o755 });

  await writeFile(path.join(fakeBin, "caddy"), `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
  version)
    echo "v2.10.2"
    ;;
  validate)
    config=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--config" ]]; then config="$2"; shift 2; else shift; fi
    done
    [[ -n "$config" ]]
    ! grep -Fq "BROKEN_CONFIG" "$config"
    ;;
  *)
    exit 2
    ;;
esac
`, { mode: 0o755 });

  await writeFile(path.join(fakeBin, "systemctl"), `#!/usr/bin/env bash
set -Eeuo pipefail
echo "$*" >> "$FAKE_SYSTEMCTL_LOG"
if [[ "$*" == "is-active --quiet caddy" ]]; then exit 0; fi
if [[ "$*" == "reload caddy" ]]; then
  if [[ "\${FAKE_RELOAD_FAIL_ONCE:-0}" == "1" && ! -e "$FAKE_RELOAD_COUNTER" ]]; then
    : > "$FAKE_RELOAD_COUNTER"
    exit 1
  fi
  exit 0
fi
exit 0
`, { mode: 0o755 });

  return { root, fakeBin, caddyfile, snippet, systemctlLog, reloadCounter, original };
}

function envFor(value, overrides = {}) {
  return {
    ...process.env,
    PATH: value.fakeBin + path.delimiter + process.env.PATH,
    FAKE_SYSTEMCTL_LOG: value.systemctlLog,
    FAKE_RELOAD_COUNTER: value.reloadCounter,
    ZSSH_PUBLIC_BASE_URL: "https://zssh.prod.example",
    ZSSH_PUBLIC_GATEWAY_PORT: "8789",
    ZSSH_CADDY_ROOT_FILE: value.caddyfile,
    ZSSH_CADDY_SNIPPET_FILE: value.snippet,
    ZSSH_CADDY_TEST_MODE: "1",
    ...overrides,
  };
}

async function run(value, overrides = {}) {
  return execFileAsync(
    "bash",
    ["deploy/install-public-caddy.sh", ROOT],
    { cwd: ROOT, env: envFor(value, overrides) },
  );
}

test("public Caddy installer adds one managed import, validates, and gracefully reloads", async () => {
  const value = await fixture();
  try {
    const first = await run(value);
    assert.match(first.stdout, /ZSSH_PUBLIC_CADDY_INSTALL_GREEN/);

    const rootAfter = await readFile(value.caddyfile, "utf8");
    const snippetAfter = await readFile(value.snippet, "utf8");
    assert.equal((rootAfter.match(/# BEGIN zSSH managed public ingress/g) || []).length, 1);
    assert.equal((rootAfter.match(/# END zSSH managed public ingress/g) || []).length, 1);
    assert.match(rootAfter, new RegExp(`import ${value.snippet.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&")}`));
    assert.match(snippetAfter, /zssh\.prod\.example \{/);
    assert.match(snippetAfter, /reverse_proxy 127\.0\.0\.1:8789/);

    const second = await run(value);
    assert.match(second.stdout, /ZSSH_PUBLIC_CADDY_INSTALL_GREEN/);
    const rootAgain = await readFile(value.caddyfile, "utf8");
    assert.equal((rootAgain.match(/# BEGIN zSSH managed public ingress/g) || []).length, 1);

    const systemctl = await readFile(value.systemctlLog, "utf8");
    assert.match(systemctl, /is-active --quiet caddy/);
    assert.match(systemctl, /reload caddy/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("public Caddy installer restores disk state when reload fails", async () => {
  const value = await fixture();
  try {
    await assert.rejects(() => run(value, { FAKE_RELOAD_FAIL_ONCE: "1" }));

    assert.equal(await readFile(value.caddyfile, "utf8"), value.original);
    await assert.rejects(() => readFile(value.snippet, "utf8"), /ENOENT/);

    const systemctl = await readFile(value.systemctlLog, "utf8");
    const reloads = systemctl.split(/\r?\n/).filter(line => line === "reload caddy");
    assert.equal(reloads.length, 2);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("public Caddy installer is non-mutating in validate-only mode", async () => {
  const value = await fixture();
  try {
    const before = await readFile(value.caddyfile, "utf8");
    const result = await run(value, { ZSSH_CADDY_VALIDATE_ONLY: "1" });
    assert.match(result.stdout, /ZSSH_PUBLIC_CADDY_CONFIG_GREEN/);
    assert.equal(await readFile(value.caddyfile, "utf8"), before);
    await assert.rejects(() => readFile(value.snippet, "utf8"), /ENOENT/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("public Caddy installer rejects symlink root configuration", async () => {
  const value = await fixture();
  const real = path.join(value.root, "real-Caddyfile");
  try {
    await writeFile(real, value.original);
    await rm(value.caddyfile);
    await symlink(real, value.caddyfile);

    await assert.rejects(
      () => run(value),
      /Refusing symlink Caddy root config/,
    );
    const info = await lstat(value.caddyfile);
    assert.equal(info.isSymbolicLink(), true);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("public Caddy installer rejects duplicate managed markers before mutation", async () => {
  const value = await fixture();
  try {
    await writeFile(
      value.caddyfile,
      value.original +
        "\n# BEGIN zSSH managed public ingress\n" +
        "# BEGIN zSSH managed public ingress\n" +
        "import /tmp/duplicate\n" +
        "# END zSSH managed public ingress\n",
    );
    await assert.rejects(() => run(value), /duplicate or incomplete zSSH managed markers/);
    await assert.rejects(() => readFile(value.snippet, "utf8"), /ENOENT/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});


test("public Caddy renderer is loaded from the exact immutable Git commit", async () => {
  const installer = await readFile(path.join(ROOT, "deploy", "install-public-caddy.sh"), "utf8");

  assert.match(installer, /ZSSH_EXPECTED_SHA/);
  assert.match(
    installer,
    /archive --format=tar "\$REPO_SHA" scripts\/render-public-caddy\.mjs/,
  );
  assert.match(installer, /"\$NODE_BIN" "\$renderer" > "\$rendered"/);
  assert.doesNotMatch(
    installer,
    /"\$NODE_BIN" "\$SOURCE_ROOT\/scripts\/render-public-caddy\.mjs"/,
  );
  assert.match(installer, /release_sha=%s/);
});
