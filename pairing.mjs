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
  return { version: 2, pairings: {}, requests: {} };
}

async function readRegistry(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return {
      version: 2,
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
  await fs.writeFile(temp, JSON.stringify({ ...registry, version: 2 }, null, 2) + "\n", {
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

export function normalizeTargetId(value) {
  const id = String(value || "").trim();
  if (id === "local") return id;
  if (!/^zt_[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new Error("target id must be local or an opaque zt_ identifier");
  }
  return id;
}

export function targetIdFromEnv(env = process.env) {
  return normalizeTargetId(String(env.ZSSH_TARGET_ID || "").trim() || "local");
}

function pairingKey(profileId, targetId) {
  return profileId + "::" + targetId;
}

function findPairing(registry, profileId, targetId) {
  const exactKey = pairingKey(profileId, targetId);
  if (registry.pairings[exactKey]) {
    return { key: exactKey, value: registry.pairings[exactKey] };
  }

  // Version-1 registries keyed directly by profile id. They are valid only for
  // the reserved local target and are never silently migrated to another target.
  if (targetId === "local" && registry.pairings[profileId] && !registry.pairings[profileId].target_id) {
    return { key: profileId, value: registry.pairings[profileId] };
  }

  return null;
}

function pairingProfileId(key, value) {
  if (value?.profile_id) return value.profile_id;
  return String(key).split("::", 1)[0];
}

function pairingTargetId(key, value) {
  if (value?.target_id) return normalizeTargetId(value.target_id);
  return String(key).includes("::") ? normalizeTargetId(String(key).split("::").at(-1)) : "local";
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
  targetId,
  env = process.env,
  now = Date.now(),
} = {}) {
  const file = pairingPath(env);
  const profileId = profileIdFromAuth(authInfo, resource);
  const resolvedTargetId = normalizeTargetId(targetId || targetIdFromEnv(env));

  return serialized(async () => {
    const registry = await readRegistry(file);
    const changed = pruneExpired(registry, now);
    const found = findPairing(registry, profileId, resolvedTargetId);
    const pairing = found?.value;

    if (pairing && !pairing.revoked_at) {
      if (changed) await writeRegistry(file, registry);
      return {
        paired: true,
        pending: false,
        profile_id: profileId,
        target_id: resolvedTargetId,
        paired_at: pairing.paired_at,
        revoked_at: null,
      };
    }

    const pendingEntry = Object.entries(registry.requests)
      .find(([, request]) =>
        request?.profile_id === profileId &&
        normalizeTargetId(request?.target_id || "local") === resolvedTargetId
      );
    if (pendingEntry) {
      if (changed) await writeRegistry(file, registry);
      return {
        paired: false,
        pending: true,
        profile_id: profileId,
        target_id: resolvedTargetId,
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
        target_id: resolvedTargetId,
        revoked_at: pairing?.revoked_at || null,
      };
    }

    const requestId = "pair_" + crypto.randomBytes(12).toString("hex");
    const expiresAt = now + ttlSeconds(env) * 1000;
    registry.requests[requestId] = {
      profile_id: profileId,
      target_id: resolvedTargetId,
      created_at: nowIso(now),
      expires_at: nowIso(expiresAt),
    };
    await writeRegistry(file, registry);
    return {
      paired: false,
      pending: true,
      profile_id: profileId,
      target_id: resolvedTargetId,
      request_id: requestId,
      expires_at: nowIso(expiresAt),
    };
  });
}

export async function approvePairing(requestId, {
  targetId,
  env = process.env,
  now = Date.now(),
} = {}) {
  const id = String(requestId || "").trim();
  if (!id) throw new Error("pairing request id is required");
  const file = pairingPath(env);

  return serialized(async () => {
    const registry = await readRegistry(file);
    pruneExpired(registry, now);
    const request = registry.requests[id];
    if (!request) throw new Error("pairing request not found or expired");

    const requestTargetId = normalizeTargetId(request.target_id || "local");
    const scopedTargetId = targetId ? normalizeTargetId(targetId) : null;
    if (scopedTargetId && requestTargetId !== scopedTargetId) {
      throw new Error("pairing request belongs to a different target");
    }

    const key = pairingKey(request.profile_id, requestTargetId);
    registry.pairings[key] = {
      profile_id: request.profile_id,
      target_id: requestTargetId,
      paired_at: nowIso(now),
      revoked_at: null,
    };
    delete registry.requests[id];
    await writeRegistry(file, registry);
    return {
      paired: true,
      profile_id: request.profile_id,
      target_id: requestTargetId,
      paired_at: registry.pairings[key].paired_at,
    };
  });
}

export async function revokePairing(profileId, {
  targetId,
  env = process.env,
  now = Date.now(),
} = {}) {
  const id = String(profileId || "").trim();
  if (!id) throw new Error("profile id is required");
  const file = pairingPath(env);
  const requestedTarget = targetId ? normalizeTargetId(targetId) : null;

  return serialized(async () => {
    const registry = await readRegistry(file);
    const matches = Object.entries(registry.pairings)
      .filter(([key, value]) =>
        pairingProfileId(key, value) === id &&
        (!requestedTarget || pairingTargetId(key, value) === requestedTarget)
      );

    let revoked = 0;
    const revokedAt = nowIso(now);
    for (const [, pairing] of matches) {
      if (!pairing.revoked_at) {
        pairing.revoked_at = revokedAt;
        revoked += 1;
      }
    }

    if (revoked) await writeRegistry(file, registry);
    return {
      revoked: revoked > 0,
      revoked_count: revoked,
      profile_id: id,
      target_id: requestedTarget,
      revoked_at: revoked ? revokedAt : null,
    };
  });
}

export async function listPairings({
  targetId,
  env = process.env,
  now = Date.now(),
} = {}) {
  const requestedTarget = targetId ? normalizeTargetId(targetId) : null;
  const file = pairingPath(env);
  return serialized(async () => {
    const registry = await readRegistry(file);
    const changed = pruneExpired(registry, now);
    if (changed) await writeRegistry(file, registry);
    return {
      pairings: Object.entries(registry.pairings)
        .map(([key, value]) => ({
          profile_id: pairingProfileId(key, value),
          target_id: pairingTargetId(key, value),
          paired_at: value.paired_at || null,
          revoked_at: value.revoked_at || null,
          active: !value.revoked_at,
        }))
        .filter(value => !requestedTarget || value.target_id === requestedTarget),
      requests: Object.entries(registry.requests)
        .map(([request_id, value]) => ({
          request_id,
          profile_id: value.profile_id,
          target_id: normalizeTargetId(value.target_id || "local"),
          created_at: value.created_at,
          expires_at: value.expires_at,
        }))
        .filter(value => !requestedTarget || value.target_id === requestedTarget),
    };
  });
}
