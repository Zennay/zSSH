import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createClientToken,
  listClientTokens,
  revokeClientToken,
  verifyClientToken
} from "../auth-store.mjs";

test("revocable client tokens are stored hashed, mode 0600, and revoke immediately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-token-test-"));
  const previous = process.env.ZSSH_CLIENT_TOKENS_FILE;
  const storePath = path.join(root, "config", "clients.json");
  process.env.ZSSH_CLIENT_TOKENS_FILE = storePath;

  try {
    const created = await createClientToken("chatgpt-test");
    assert.match(created.token, /^zssh_[0-9a-f]{16}_[A-Za-z0-9_-]{40,}$/);

    const rawStore = await readFile(storePath, "utf8");
    assert.equal(rawStore.includes(created.token), false);
    assert.match(rawStore, /"token_hash": "[0-9a-f]{64}"/);
    assert.equal((await stat(storePath)).mode & 0o777, 0o600);

    const verified = await verifyClientToken(created.token);
    assert.equal(verified?.id, created.id);
    assert.equal(verified?.label, "chatgpt-test");

    const listed = await listClientTokens();
    assert.deepEqual(listed.map(entry => entry.id), [created.id]);
    assert.equal(JSON.stringify(listed).includes(created.token), false);

    assert.equal(await verifyClientToken(created.token + "x"), null);
    assert.equal(await revokeClientToken(created.id), true);
    assert.equal(await verifyClientToken(created.token), null);
    assert.equal(await revokeClientToken(created.id), false);
  } finally {
    if (previous === undefined) delete process.env.ZSSH_CLIENT_TOKENS_FILE;
    else process.env.ZSSH_CLIENT_TOKENS_FILE = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("client token labels reject shell/control characters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-token-label-"));
  const previous = process.env.ZSSH_CLIENT_TOKENS_FILE;
  process.env.ZSSH_CLIENT_TOKENS_FILE = path.join(root, "clients.json");
  try {
    await assert.rejects(() => createClientToken("bad\nlabel"), /client label/);
    await assert.rejects(() => createClientToken("bad;label"), /client label/);
  } finally {
    if (previous === undefined) delete process.env.ZSSH_CLIENT_TOKENS_FILE;
    else process.env.ZSSH_CLIENT_TOKENS_FILE = previous;
    await rm(root, { recursive: true, force: true });
  }
});
