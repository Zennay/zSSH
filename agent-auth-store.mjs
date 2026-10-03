import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { normalizeTargetId } from "./pairing.mjs";

const STORE_VERSION = 1;
const MAX_AGENTS = 256;
const MAX_STORE_BYTES = 524288;

export function agentTokenStorePath(env = process.env) {
  return path.resolve(
    env.ZSSH_AGENT_TOKENS_FILE ||
      path.join(os.homedir(), ".config", "zssh", "agents.json")
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
  const value = String(label || "target-agent").trim();
  if (!/^[A-Za-z0-9._:@ -]{1,64}$/.test(value)) {
    throw new Error("agent label must be 1-64 characters using letters, numbers, spaces, . _ : @ or -");
  }
  return value;
}

function validateStore(parsed) {
  if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.agents)) {
    throw new Error("unsupported zSSH agent token store");
  }
  if (parsed.agents.length > MAX_AGENTS) {
    throw new Error("zSSH agent token store exceeds maximum agents");
  }
  for (const entry of parsed.agents) {
    if (
      !entry ||
      !/^[0-9a-f]{16}$/.test(String(entry.id || "")) ||
      typeof entry.label !== "string" ||
      normalizeTargetId(entry.target_id) !== entry.target_id ||
      !/^[0-9a-f]{64}$/.test(String(entry.token_hash || "")) ||
      typeof entry.created_at !== "string"
    ) {
      throw new Error("invalid zSSH agent token store entry");
    }
  }
  return parsed;
}

async function readStore(env = process.env) {
  const file = agentTokenStorePath(env);
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("zSSH agent token store must be a regular file");
    if (stat.size > MAX_STORE_BYTES) throw new Error("zSSH agent token store is too large");
    const parsed = validateStore(JSON.parse(await fs.readFile(file, "utf8")));
    return { file, store: parsed };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { file, store: { version: STORE_VERSION, agents: [] } };
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
      flag: "wx",
    });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

async function withStoreLock(callback, env = process.env) {
  const file = agentTokenStorePath(env);
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
  if (!handle) throw new Error("zSSH agent token store is busy");

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lock, { force: true }).catch(() => {});
  }
}

export async function createAgentToken(targetId, label = "target-agent", { env = process.env, now = Date.now() } = {}) {
  const target = normalizeTargetId(targetId);
  if (target === "local") throw new Error("agent tokens require an explicit opaque zt_ target id");
  return withStoreLock(async () => {
    const normalizedLabel = normalizeLabel(label);
    const { file, store } = await readStore(env);
    if (store.agents.length >= MAX_AGENTS) throw new Error("maximum number of zSSH agent tokens reached");

    let id;
    do {
      id = crypto.randomBytes(8).toString("hex");
    } while (store.agents.some(entry => entry.id === id));

    const secret = crypto.randomBytes(32).toString("base64url");
    const token = `zssh_agent_${id}_${secret}`;
    const createdAt = new Date(now).toISOString();

    store.agents.push({
      id,
      target_id: target,
      label: normalizedLabel,
      token_hash: hashToken(token),
      created_at: createdAt,
    });
    await writeStore(file, store);

    return { id, target_id: target, label: normalizedLabel, token, created_at: createdAt };
  }, env);
}

export async function verifyAgentToken(token, { env = process.env } = {}) {
  const value = String(token || "");
  if (!/^zssh_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{40,}$/.test(value)) return null;

  const id = value.slice("zssh_agent_".length, "zssh_agent_".length + 16);
  const { store } = await readStore(env);
  const agent = store.agents.find(entry => entry.id === id);
  if (!agent) return null;

  const actual = hashToken(value);
  if (!safeEqualHex(actual, agent.token_hash)) return null;
  return {
    id: agent.id,
    target_id: agent.target_id,
    label: agent.label,
    created_at: agent.created_at,
  };
}

export async function listAgentTokens({ env = process.env } = {}) {
  const { store } = await readStore(env);
  return store.agents.map(({ id, target_id, label, created_at }) => ({
    id,
    target_id,
    label,
    created_at,
  }));
}

export async function revokeAgentToken(id, { env = process.env } = {}) {
  return withStoreLock(async () => {
    const value = String(id || "").trim();
    if (!/^[0-9a-f]{16}$/.test(value)) throw new Error("invalid agent token id");

    const { file, store } = await readStore(env);
    const before = store.agents.length;
    store.agents = store.agents.filter(entry => entry.id !== value);
    if (store.agents.length === before) return false;
    await writeStore(file, store);
    return true;
  }, env);
}
