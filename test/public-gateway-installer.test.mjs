import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, mkdir, readdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "zssh-public-gateway-"));
  const config = path.join(home, ".config", "zssh");
  const review = path.join(home, "review");
  await mkdir(config, { recursive: true, mode: 0o700 });
  await mkdir(review, { recursive: true, mode: 0o700 });

  const targetId = "zt_gatewaytest12";
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const trustFile = path.join(config, "reviewer-agent-public.json");
  await writeFile(trustFile, JSON.stringify({
    version: 1,
    targets: {
      [targetId]: {
        enabled: true,
        public_key_pem: publicKey.export({ type: "spki", format: "pem" }),
      },
    },
  }, null, 2) + "\n", { mode: 0o600 });

  return { home, review, targetId, trustFile };
}

function envFor(value, overrides = {}) {
  return {
    ...process.env,
    HOME: value.home,
    ZSSH_PUBLIC_BASE_URL: "https://mcp.review.example",
    ZSSH_OAUTH_ISSUER: "https://auth.review.example",
    ZSSH_OAUTH_JWKS_URI: "https://auth.review.example/.well-known/jwks.json",
    ZSSH_TARGET_ID: value.targetId,
    ZSSH_AGENT_PUBLIC_KEYS_FILE: value.trustFile,
    ZSSH_PUBLIC_ALLOWED_ROOTS: value.review,
    ZSSH_PUBLIC_GATEWAY_VALIDATE_ONLY: "1",
    ...overrides,
  };
}

test("public gateway installer validates a reviewer OAuth/outbound-agent configuration without mutating runtime", async () => {
  const value = await fixture();
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["deploy/install-public-gateway.sh", ROOT],
      { cwd: ROOT, env: envFor(value) },
    );
    assert.equal(stderr, "");
    assert.match(stdout, /"endpoint": "https:\/\/mcp\.review\.example\/mcp"/);
    assert.match(stdout, /"trusted_target_count": 1/);
    assert.match(stdout, /ZSSH_PUBLIC_GATEWAY_CONFIG_GREEN/);
    await assert.rejects(() => readFile(path.join(value.home, ".config", "zssh", "public-gateway.env"), "utf8"), /ENOENT/);
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});

test("public gateway installer removes first-install env/current state when service activation fails", async () => {
  const value = await fixture();
  const fakeBin = path.join(value.home, "fake-bin");
  const releaseRoot = path.join(value.home, ".local", "share", "zssh-public", "releases");
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      path.join(fakeBin, "systemctl"),
      `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\$*" == *"enable --now zssh-public.service"* ]]; then
  exit 1
fi
exit 0
`,
      { mode: 0o755 },
    );
    const { stdout: repoShaRaw } = await execFileAsync("git", ["-C", ROOT, "rev-parse", "HEAD"]);
    const repoSha = repoShaRaw.trim();
    await mkdir(path.join(releaseRoot, repoSha), { recursive: true });

    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value, {
          ZSSH_PUBLIC_GATEWAY_VALIDATE_ONLY: "0",
          PATH: fakeBin + path.delimiter + process.env.PATH,
        }),
      }),
    );

    const envFile = path.join(value.home, ".config", "zssh", "public-gateway.env");
    const currentLink = path.join(value.home, ".local", "share", "zssh-public", "current");
    await assert.rejects(() => readFile(envFile, "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(currentLink, "utf8"), /ENOENT/);

    const configEntries = await readdir(path.join(value.home, ".config", "zssh"));
    assert.equal(configEntries.some(name => name.includes("public-gateway.env.backup.")), false);
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});

test("public gateway installer refuses IP-literal production origins", async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value, { ZSSH_PUBLIC_BASE_URL: "https://203.0.113.10" }),
      }),
      /public DNS hostname/,
    );
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});

test("public gateway installer treats reviewer trust file integrity as an authorization boundary", async () => {
  const value = await fixture();
  const link = path.join(path.dirname(value.trustFile), "trust-link.json");
  try {
    await symlink(value.trustFile, link);
    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value, { ZSSH_AGENT_PUBLIC_KEYS_FILE: link }),
      }),
      /regular non-symlink/,
    );

    await chmod(value.trustFile, 0o622);
    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value),
      }),
      /group\/world writable/,
    );
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});


test("public gateway installer rejects an unsafe public OAuth rate limit", async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value, { ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE: "0" }),
      }),
      /ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE must be an integer between 1 and 6000/,
    );
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});

test("public gateway installer rejects an unsafe public rate-limit profile table size", async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      () => execFileAsync("bash", ["deploy/install-public-gateway.sh", ROOT], {
        cwd: ROOT,
        env: envFor(value, { ZSSH_PUBLIC_RATE_LIMIT_MAX_PROFILES: "2" }),
      }),
      /ZSSH_PUBLIC_RATE_LIMIT_MAX_PROFILES must be an integer between 100 and 100000/,
    );
  } finally {
    await rm(value.home, { recursive: true, force: true });
  }
});

test("public gateway service and installer preserve isolated hardened deployment boundaries", async () => {
  const installer = await readFile(path.join(ROOT, "deploy", "install-public-gateway.sh"), "utf8");
  const unit = await readFile(path.join(ROOT, "deploy", "zssh-public.service.in"), "utf8");

  assert.match(installer, /git -C "\$SOURCE_ROOT" archive --format=tar "\$REPO_SHA"/);
  assert.doesNotMatch(installer, /cp -a "\$SOURCE_ROOT\/\."/);
  assert.match(installer, /rollback_public_gateway/);
  assert.match(installer, /public-gateway\.env\.backup\.\$\$/);
  assert.match(installer, /rm -f "\$ENV_FILE"/);
  assert.match(installer, /ZSSH_PLUGIN_PROFILE=public/);
  assert.match(installer, /ZSSH_PUBLIC_AUTH_MODE=oauth/);
  assert.match(installer, /ZSSH_PUBLIC_RATE_LIMIT_PER_MINUTE=\$RATE_LIMIT_VALUE/);
  assert.match(installer, /ZSSH_PUBLIC_RATE_LIMIT_MAX_PROFILES=\$RATE_LIMIT_MAX_PROFILES_VALUE/);
  assert.match(installer, /ZSSH_PAIRING_REQUIRED=1/);
  assert.match(installer, /ZSSH_EXEC_MODE=disabled/);
  assert.match(installer, /ZSSH_AGENT_PUBLIC_KEYS_FILE/);

  assert.match(unit, /EnvironmentFile=%h\/\.config\/zssh\/public-gateway\.env/);
  assert.match(unit, /WorkingDirectory=%h\/\.local\/share\/zssh-public\/current/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /PrivateDevices=true/);
  assert.match(unit, /ProtectSystem=full/);
});
