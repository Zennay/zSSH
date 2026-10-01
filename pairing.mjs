import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

let mutationQueue = Promise.resolve();

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function pairingPath(env = process.env) {
  const configured = String(env.ZSSH_PAIRING_FILE || "").trim();
  return path.resolve(configured || path.join(os.homedir(), ".config", "zssh", "pairings.json"));
}

function ttlSeconds(env = process.env) {
  const value = Number(env.ZSSH_PAIRING_REQUEST_TTL_SECONDS || 900);
  return Number.isInteger(value) && value >= 60 && value <= 86400 ? value : 900;
}

function emptyRegistry() {
  return { version: 1, pairings: {}, requests: {} };
}

async function readRegistry(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return {
      version: 1,
      pairings: parsed?.pairings && typeof parsed.pairings === "object" ? parsed.pairings : {},
      requests: parsed?.requests && typeof parsed.requests === "object" ? parsed.requests : {},
    };
  } catch (err) {
    if (err?.code === "ENOENT") return emptyRegistry();
    throw err;
  }
}

async function writeRegistry(file, registry) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temp, JSON.stringify(registry, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temp, file);
}

function serialized(fn) {
  const run = mutationQueue.then(fn, fn);
  mutationQueue = run.catch(() => {});
  return run;
}

function pruneExpired(registry, now = Date.now()) {
  let changed = false;
  for (const [requestId, request] of Object.entries(registry.requests || {})) {
    const expires = Date.parse(request?.expires_at || "");
    if (!Number.isFinite(expires) || expires <= now) {
      delete registry.requests[requestId];
      changed = true;
    }
  }
  return changed;
}

export function profileIdFromAuth(authInfo, resource = "") {
  const subject = String(authInfo?.extra?.sub || authInfo?.clientId || "").trim();
  if (!subject) throw new Error("authenticated identity has no stable subject");
  const issuer = String(authInfo?.extra?.issuer || "").trim();
  return "zssh_" + crypto.createHash("sha256")
    .update(issuer + "\u0000" + subject + "\u0000" + String(resource || ""))
    .digest("hex")
    .slice(0, 32);
}

export async function getPairingStatus(authInfo, {
  resource = "",
  createRequest = false,
  env = process.env,
  now = Date.now(),
} = {}) {
  const file = pairingPath(env);
  const profileId = profileIdFromAuth(authInfo, resource);

  return serialized(async () => {
    const registry = await readRegistry(file);
    const changed = pruneExpired(registry, now);
    const pairing = registry.pairings[profileId];

    if (pairing && !pairing.revoked_at) {
      if (changed) await writeRegistry(file, registry);
      return {
        paired: true,
        pending: false,
        profile_id: profileId,
        paired_at: pairing.paired_at,
        revoked_at: null,
      };
    }

    const pendingEntry = Object.entries(registry.requests)
      .find(([, request]) => request?.profile_id === profileId);
    if (pendingEntry) {
      if (changed) await writeRegistry(file, registry);
      return {
        paired: false,
        pending: true,
        profile_id: profileId,
        request_id: pendingEntry[0],
        expires_at: pendingEntry[1].expires_at,
      };
    }

    if (!createRequest) {
      if (changed) await writeRegistry(file, registry);
      return {
        paired: false,
        pending: false,
        profile_id: profileId,
        revoked_at: pairing?.revoked_at || null,
      };
    }

    const requestId = "pair_" + crypto.randomBytes(12).toString("hex");
    const expiresAt = now + ttlSeconds(env) * 1000;
    registry.requests[requestId] = {
      profile_id: profileId,
      created_at: nowIso(now),
      expires_at: nowIso(expiresAt),
    };
    await writeRegistry(file, registry);
    return {
      paired: false,
      pending: true,
      profile_id: profileId,
      request_id: requestId,
      expires_at: nowIso(expiresAt),
    };
  });
}

export async function approvePairing(requestId, { env = process.env, now = Date.now() } = {}) {
  const id = String(requestId || "").trim();
  if (!id) throw new Error("pairing request id is required");
  const file = pairingPath(env);

  return serialized(async () => {
    const registry = await readRegistry(file);
    pruneExpired(registry, now);
    const request = registry.requests[id];
    if (!request) throw new Error("pairing request not found or expired");

    registry.pairings[request.profile_id] = {
      paired_at: nowIso(now),
      revoked_at: null,
    };
    delete registry.requests[id];
    await writeRegistry(file, registry);
    return {
      paired: true,
      profile_id: request.profile_id,
      paired_at: registry.pairings[request.profile_id].paired_at,
    };
  });
}

export async function revokePairing(profileId, { env = process.env, now = Date.now() } = {}) {
  const id = String(profileId || "").trim();
  if (!id) throw new Error("profile id is required");
  const file = pairingPath(env);

  return serialized(async () => {
    const registry = await readRegistry(file);
    const pairing = registry.pairings[id];
    if (!pairing || pairing.revoked_at) {
      return { revoked: false, profile_id: id };
    }
    pairing.revoked_at = nowIso(now);
    await writeRegistry(file, registry);
    return { revoked: true, profile_id: id, revoked_at: pairing.revoked_at };
  });
}

export async function listPairings({ env = process.env, now = Date.now() } = {}) {
  const file = pairingPath(env);
  return serialized(async () => {
    const registry = await readRegistry(file);
    const changed = pruneExpired(registry, now);
    if (changed) await writeRegistry(file, registry);
    return {
      pairings: Object.entries(registry.pairings).map(([profile_id, value]) => ({
        profile_id,
        paired_at: value.paired_at || null,
        revoked_at: value.revoked_at || null,
        active: !value.revoked_at,
      })),
      requests: Object.entries(registry.requests).map(([request_id, value]) => ({
        request_id,
        profile_id: value.profile_id,
        created_at: value.created_at,
        expires_at: value.expires_at,
      })),
    };
  });
}
