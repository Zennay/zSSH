import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

const ORIGINAL = `{
    admin off
    auto_https disable_redirects
}

https://198.244.191.182 {
    tls {
        issuer acme https://acme-v02.api.letsencrypt.org/directory {
            profile shortlived
        }
    }

    header {
        X-Content-Type-Options nosniff
        Referrer-Policy same-origin
    }

    reverse_proxy 127.0.0.1:8788
}
`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-docker-caddy-"));
  const bin = path.join(root, "bin");
  const containerRoot = path.join(root, "container");
  const config = path.join(root, "Caddyfile");
  const dockerLog = path.join(root, "docker.log");
  await mkdir(bin, { recursive: true });
  await mkdir(containerRoot, { recursive: true });
  await writeFile(config, ORIGINAL);

  await writeFile(path.join(bin, "sudo"), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${1:-}" == "-n" ]]; then shift; fi
exec "$@"
`, { mode: 0o755 });

  await writeFile(path.join(bin, "docker"), `#!/usr/bin/env bash
set -Eeuo pipefail
echo "$*" >> "$FAKE_DOCKER_LOG"
case "\${1:-}" in
  inspect)
    format="\${3:-}"
    if [[ "$format" == "{{.State.Running}}" ]]; then
      echo "\${FAKE_RUNNING:-true}"
    else
      echo "\${FAKE_RUNNING:-true}|\${FAKE_NETWORK:-host}|$FAKE_CADDYFILE|\${FAKE_MOUNT_RW:-false}"
    fi
    ;;
  cp)
    source="$2"
    destination="$3"
    destination_path="\${destination#*:}"
    mkdir -p "$FAKE_CONTAINER_ROOT$(dirname "$destination_path")"
    cp "$source" "$FAKE_CONTAINER_ROOT$destination_path"
    ;;
  exec)
    container="$2"
    shift 2
    if [[ "\${1:-}" == "caddy" && "\${2:-}" == "validate" ]]; then
      config=""
      while [[ $# -gt 0 ]]; do
        if [[ "$1" == "--config" ]]; then config="$2"; shift 2; else shift; fi
      done
      if [[ "$config" == "/etc/caddy/Caddyfile" ]]; then
        config="$FAKE_CADDYFILE"
      else
        config="$FAKE_CONTAINER_ROOT$config"
      fi
      [[ -f "$config" ]]
      if [[ "\${FAKE_VALIDATE_FAIL:-0}" == "1" ]]; then exit 1; fi
      ! grep -Fq "BROKEN_CONFIG" "$config"
    elif [[ "\${1:-}" == "rm" && "\${2:-}" == "-f" ]]; then
      rm -f "$FAKE_CONTAINER_ROOT\${3:-}"
    else
      echo "unexpected docker exec arguments" >&2
      exit 2
    fi
    ;;
  restart)
    if [[ "\${FAKE_RESTART_FAIL:-0}" == "1" ]]; then exit 1; fi
    ;;
  *)
    echo "unexpected docker arguments" >&2
    exit 2
    ;;
esac
`, { mode: 0o755 });

  await writeFile(path.join(bin, "curl"), `#!/usr/bin/env bash
set -Eeuo pipefail
url="\${@: -1}"
if [[ "$url" == http://127.0.0.1:8789/health ]]; then
  [[ "\${FAKE_GATEWAY_FAIL:-0}" != "1" ]] || exit 22
elif [[ "$url" == https://zssh.zennay.nl/health ]]; then
  [[ "\${FAKE_TLS_FAIL:-0}" != "1" ]] || exit 22
else
  echo "unexpected curl URL: $url" >&2
  exit 2
fi
printf '{"ok":true,"service":"zssh"}\\n'
`, { mode: 0o755 });

  return { root, bin, containerRoot, config, dockerLog };
}

function envFor(value, overrides = {}) {
  return {
    ...process.env,
    PATH: value.bin + path.delimiter + process.env.PATH,
    FAKE_DOCKER_LOG: value.dockerLog,
    FAKE_CONTAINER_ROOT: value.containerRoot,
    FAKE_CADDYFILE: value.config,
    ZSSH_PUBLIC_BASE_URL: "https://zssh.zennay.nl",
    ZSSH_PUBLIC_GATEWAY_PORT: "8789",
    ZSSH_CADDY_DOCKER_ROOT_FILE: value.config,
    ZSSH_CADDY_DOCKER_TEST_MODE: "1",
    ZSSH_CADDY_HEALTH_ATTEMPTS: "1",
    ...overrides,
  };
}

async function run(value, overrides = {}) {
  return execFileAsync("bash", ["deploy/install-public-caddy-docker.sh", ROOT], {
    cwd: ROOT,
    env: envFor(value, overrides),
  });
}

test("Docker Caddy promotion changes only hostname and upstream, then proves HTTPS health", async () => {
  const value = await fixture();
  try {
    const result = await run(value);
    assert.match(result.stdout, /ZSSH_PUBLIC_CADDY_DOCKER_INSTALL_GREEN host=zssh\.zennay\.nl port=8789/);
    const actual = await readFile(value.config, "utf8");
    assert.match(actual, /zssh\.zennay\.nl \{/);
    assert.match(actual, /reverse_proxy 127\.0\.0\.1:8789/);
    assert.doesNotMatch(actual, /reverse_proxy 127\.0\.0\.1:8788/);
    assert.match(actual, /admin off/);
    assert.match(actual, /auto_https disable_redirects/);
    assert.match(actual, /profile shortlived/);
    assert.match(actual, /X-Content-Type-Options nosniff/);
    assert.match(actual, /Referrer-Policy same-origin/);
    const log = await readFile(value.dockerLog, "utf8");
    assert.match(log, /inspect --format/);
    assert.match(log, /caddy validate --config/);
    assert.match(log, /restart --time 10 zssh-https/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Docker Caddy promotion is idempotent after successful activation", async () => {
  const value = await fixture();
  try {
    await run(value);
    const first = await readFile(value.dockerLog, "utf8");
    const firstRestarts = first.split("\n").filter(line => line.startsWith("restart ")).length;
    const second = await run(value);
    assert.match(second.stdout, /ZSSH_PUBLIC_CADDY_DOCKER_INSTALL_GREEN/);
    const log = await readFile(value.dockerLog, "utf8");
    assert.equal(log.split("\n").filter(line => line.startsWith("restart ")).length, firstRestarts);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Docker Caddy promotion restores the previous config when HTTPS health fails", async () => {
  const value = await fixture();
  try {
    await assert.rejects(() => run(value, { FAKE_TLS_FAIL: "1" }));
    assert.equal(await readFile(value.config, "utf8"), ORIGINAL);
    const log = await readFile(value.dockerLog, "utf8");
    assert.equal(log.split("\n").filter(line => line.startsWith("restart ")).length, 2);
    assert.match(log, /caddy validate --config \/etc\/caddy\/Caddyfile/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Docker Caddy promotion refuses an unhealthy public gateway before mutation", async () => {
  const value = await fixture();
  try {
    await assert.rejects(() => run(value, { FAKE_GATEWAY_FAIL: "1" }));
    assert.equal(await readFile(value.config, "utf8"), ORIGINAL);
    const log = await readFile(value.dockerLog, "utf8");
    assert.doesNotMatch(log, /restart --time 10 zssh-https/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Docker Caddy promotion fails closed on unexpected network or mount topology", async () => {
  const value = await fixture();
  try {
    await assert.rejects(() => run(value, { FAKE_NETWORK: "bridge" }));
    assert.equal(await readFile(value.config, "utf8"), ORIGINAL);
    await assert.rejects(() => run(value, { FAKE_MOUNT_RW: "true" }));
    assert.equal(await readFile(value.config, "utf8"), ORIGINAL);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Docker Caddy promotion refuses invalid candidate config before mutation", async () => {
  const value = await fixture();
  try {
    await assert.rejects(() => run(value, { FAKE_VALIDATE_FAIL: "1" }));
    assert.equal(await readFile(value.config, "utf8"), ORIGINAL);
    const log = await readFile(value.dockerLog, "utf8");
    assert.doesNotMatch(log, /restart --time 10 zssh-https/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
