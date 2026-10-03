import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const STORE_VERSION = 1;
const MAX_CLIENTS = 64;
const MAX_STORE_BYTES = 262144;

export function clientTokenStorePath() {
  return path.resolve(
    process.env.ZSSH_CLIENT_TOKENS_FILE ||
      path.join(os.homedir(), ".config", "zssh", "clients.json")
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function safeEqualHex(actual, expected) {
  const a = Buffer.from(String(actual || ""), "hex");
  const b = Buffer.from(String(expected || ""), "hex");
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

function normalizeLabel(label) {
  const value = String(label || "chatgpt").trim();
  if (!/^[A-Za-z0-9._:@ -]{1,64}$/.test(value)) {
    throw new Error("client label must be 1-64 characters using letters, numbers, spaces, . _ : @ or -");
  }
  return value;
}

function validateStore(parsed) {
  if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.clients)) {
    throw new Error("unsupported zSSH client token store");
  }
  if (parsed.clients.length > MAX_CLIENTS) {
    throw new Error("zSSH client token store exceeds maximum clients");
  }
  for (const entry of parsed.clients) {
    if (
      !entry ||
      !/^[0-9a-f]{16}$/.test(String(entry.id || "")) ||
      typeof entry.label !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(entry.token_hash || "")) ||
      typeof entry.created_at !== "string"
    ) {
      throw new Error("invalid zSSH client token store entry");
    }
  }
  return parsed;
}

async function readStore() {
  const file = clientTokenStorePath();
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("zSSH client token store must be a regular file");
    if (stat.size > MAX_STORE_BYTES) throw new Error("zSSH client token store is too large");
    const parsed = validateStore(JSON.parse(await fs.readFile(file, "utf8")));
    return { file, store: parsed };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { file, store: { version: STORE_VERSION, clients: [] } };
    }
    throw err;
  }
}

async function writeStore(file, store) {
  validateStore(store);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const tmp = file + ".tmp-" + crypto.randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function withStoreLock(callback) {
  const file = clientTokenStorePath();
  const lock = file + ".lock";
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(file), 0o700);

  let handle;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lock, "wx", 0o600);
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error("zSSH client token store is busy");

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lock, { force: true }).catch(() => {});
  }
}

export async function createClientToken(label = "chatgpt") {
  return withStoreLock(async () => {
    const normalizedLabel = normalizeLabel(label);
    const { file, store } = await readStore();
    if (store.clients.length >= MAX_CLIENTS) {
      throw new Error("maximum number of zSSH client tokens reached");
    }

    let id;
    do {
      id = crypto.randomBytes(8).toString("hex");
    } while (store.clients.some(entry => entry.id === id));

    const secret = crypto.randomBytes(32).toString("base64url");
    const token = `zssh_${id}_${secret}`;
    const createdAt = new Date().toISOString();

    store.clients.push({
      id,
      label: normalizedLabel,
      token_hash: hashToken(token),
      created_at: createdAt
    });
    await writeStore(file, store);

    return { id, label: normalizedLabel, token, created_at: createdAt };
  });
}

export async function verifyClientToken(token) {
  const value = String(token || "");
  if (!/^zssh_[0-9a-f]{16}_[A-Za-z0-9_-]{40,}$/.test(value)) return null;

  const id = value.slice(5, 21);
  const { store } = await readStore();
  const client = store.clients.find(entry => entry.id === id);
  if (!client) return null;

  const actual = hashToken(value);
  if (!safeEqualHex(actual, client.token_hash)) return null;
  return { id: client.id, label: client.label, created_at: client.created_at };
}

export async function listClientTokens() {
  const { store } = await readStore();
  return store.clients.map(({ id, label, created_at }) => ({ id, label, created_at }));
}

export async function revokeClientToken(id) {
  return withStoreLock(async () => {
    const value = String(id || "").trim();
    if (!/^[0-9a-f]{16}$/.test(value)) throw new Error("invalid client token id");

    const { file, store } = await readStore();
    const before = store.clients.length;
    store.clients = store.clients.filter(entry => entry.id !== value);
    if (store.clients.length === before) return false;
    await writeStore(file, store);
    return true;
  });
}
