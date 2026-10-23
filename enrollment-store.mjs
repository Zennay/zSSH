import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { normalizeTargetId } from "./pairing.mjs";

// This is the durable enrollment state machine, not a public HTTP endpoint.
// Callers MUST derive profile_id from verified OAuth, not client-supplied JSON.
// Existing paired agents are not changed by this module.
const CODE_RE = /^enr_[A-Za-z0-9_-]{43}$/;
const PROFILE_RE = /^zssh_[a-f0-9]{32}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{80,120}$/;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{42,44}=?$/;
// Windows has no POSIX permission bits; the gateway only runs on Linux, but
// keep the store usable for local development and tests there.
const POSIX_MODES = process.platform !== "win32";
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;

// Server names are cosmetic (the hostname the installer reports), never an
// authorization input. Anything unexpected is dropped rather than echoed.
export function normalizeTargetLabel(value) {
  const label = String(value ?? "").trim();
  return LABEL_RE.test(label) ? label : null;
}

function profile(value) {
  const id = String(value || "");
  if (!PROFILE_RE.test(id)) throw new Error("invalid authenticated profile id");
  return id;
}

function fingerprint(key) {
  return "SHA256:" + crypto.createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("base64").replace(/=+$/, "");
}

function validatePublicKey(pem) {
  if (typeof pem !== "string" || pem.length > 512 || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new Error("expected bounded Ed25519 SPKI public key");
  }
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("expected Ed25519 public key");
  return key;
}

function requestHash(code) {
  if (!CODE_RE.test(String(code || ""))) throw new Error("invalid enrollment code");
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function canonicalEnrollmentClaim({ code, targetId, nonce }) {
  const id = normalizeTargetId(targetId);
  if (id === "local") throw new Error("enrollment requires a non-local target");
  if (!/^nonce_[A-Za-z0-9_-]{16,96}$/.test(String(nonce || ""))) {
    throw new Error("invalid enrollment nonce");
  }
  return ["zssh-enrollment-v1", id, requestHash(code), nonce].join("\n");
}

function registryFile(env) {
  return path.resolve(String(env.ZSSH_ENROLLMENT_FILE || "").trim() ||
    path.join(os.homedir(), ".config", "zssh", "enrollments.json"));
}

async function readState(file) {
  let stat;
  try { stat = await fs.lstat(file); } catch (err) {
    if (err?.code === "ENOENT") return { version: 1, requests: {}, targets: {} };
    throw err;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (POSIX_MODES && (stat.mode & 0o077) !== 0)) {
    throw new Error("enrollment state must be a private regular file");
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  if (parsed?.version !== 1 ||
    !parsed.requests || typeof parsed.requests !== "object" || Array.isArray(parsed.requests) ||
    !parsed.targets || typeof parsed.targets !== "object" || Array.isArray(parsed.targets)) {
    throw new Error("invalid enrollment registry");
  }
  return parsed;
}

async function writeState(file, state) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (POSIX_MODES && (st.mode & 0o077) !== 0)) {
    throw new Error("enrollment registry directory must be private");
  }
  const tmp = file + ".tmp-" + crypto.randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function prune(state, now) {
  for (const [hash, request] of Object.entries(state.requests)) {
    if (!Number.isFinite(request?.expires_at) || request.expires_at <= now) {
      delete state.requests[hash];
    }
  }
}

export class EnrollmentStore {
  #file;
  #queue = Promise.resolve();
  #codeTtlMs;
  #approvalTtlMs;
  #autoActivate;
  #targetLimit;

  // autoActivate: redeeming the one-use, OAuth-bound code with a valid
  // Ed25519 proof links the server immediately ("run the command and it is
  // linked"). Operators who want a second fingerprint confirmation set
  // ZSSH_ENROLLMENT_REQUIRE_APPROVAL=1. targetLimit(profileId) returns the
  // plan's maximum number of linked servers.
  constructor({
    env = process.env,
    codeTtlMs = 900000,
    approvalTtlMs = 900000,
    autoActivate = env.ZSSH_ENROLLMENT_REQUIRE_APPROVAL !== "1",
    targetLimit = async () => Infinity,
  } = {}) {
    if (![codeTtlMs, approvalTtlMs].every(x => Number.isInteger(x) && x >= 60000 && x <= 1800000)) {
      throw new Error("enrollment TTL must be 1–30 minutes");
    }
    this.#file = registryFile(env);
    this.#codeTtlMs = codeTtlMs;
    this.#approvalTtlMs = approvalTtlMs;
    this.#autoActivate = Boolean(autoActivate);
    this.#targetLimit = targetLimit;
  }

  async #assertBelowLimit(state, owner) {
    const limit = await this.#targetLimit(owner);
    const used = Object.values(state.targets).filter(t => t.profile_id === owner && !t.revoked_at).length;
    if (used >= limit) {
      const err = new Error("server limit for this plan reached (" + limit + "); upgrade or disconnect a server first");
      err.code = "plan_limit_servers";
      throw err;
    }
  }

  #serialized(fn) {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  async issue(profileId, now = Date.now()) {
    const owner = profile(profileId);
    return this.#serialized(async () => {
      const state = await readState(this.#file);
      prune(state, now);
      await this.#assertBelowLimit(state, owner);
      const active = Object.values(state.requests).filter(r => r.profile_id === owner).length;
      if (active >= 3) throw new Error("too many outstanding enrollment requests");
      if (Object.keys(state.requests).length >= 1024) throw new Error("enrollment capacity reached");
      const code = "enr_" + crypto.randomBytes(32).toString("base64url");
      const hash = requestHash(code);
      state.requests[hash] = {
        profile_id: owner,
        status: "issued",
        issued_at: now,
        expires_at: now + this.#codeTtlMs,
      };
      await writeState(this.#file, state);
      // Only returned once to the OAuth-authenticated caller. Never store or log this code.
      return { enrollment_code: code, expires_at: new Date(now + this.#codeTtlMs).toISOString() };
    });
  }

  async claim({ code, targetId, publicKeyPem, nonce, signature, label }, now = Date.now()) {
    const id = normalizeTargetId(targetId);
    const name = normalizeTargetLabel(label);
    const hash = requestHash(code);
    const key = validatePublicKey(publicKeyPem);
    const sig = String(signature || "");
    if (!SIGNATURE_RE.test(sig)) throw new Error("invalid enrollment proof");
    const canonical = canonicalEnrollmentClaim({ code, targetId: id, nonce });
    const valid = crypto.verify(null, Buffer.from(canonical), key, Buffer.from(sig, "base64url"));
    if (!valid) throw new Error("enrollment private-key proof failed");

    return this.#serialized(async () => {
      const state = await readState(this.#file);
      prune(state, now);
      const request = state.requests[hash];
      if (!request || request.status !== "issued") throw new Error("expired or already redeemed enrollment");
      if (state.targets[id]) throw new Error("target is already registered");
      if (Object.values(state.requests).some(r => r.target_id === id)) {
        throw new Error("target enrollment already pending");
      }
      const fp = fingerprint(key);
      if (this.#autoActivate) {
        await this.#assertBelowLimit(state, request.profile_id);
        state.targets[id] = {
          profile_id: request.profile_id,
          public_key_pem: key.export({ type: "spki", format: "pem" }),
          fingerprint: fp,
          label: name,
          connected_at: now,
          revoked_at: null,
        };
        delete state.requests[hash];
        await writeState(this.#file, state);
        return { connected: true, awaiting_approval: false, target_id: id, fingerprint: fp, label: name };
      }
      request.status = "awaiting_approval";
      request.label = name;
      request.target_id = id;
      request.public_key_pem = key.export({ type: "spki", format: "pem" });
      request.fingerprint = fp;
      request.claimed_at = now;
      request.expires_at = now + this.#approvalTtlMs;
      await writeState(this.#file, state);
      return {
        awaiting_approval: true,
        target_id: id,
        fingerprint: fp,
        expires_at: new Date(request.expires_at).toISOString(),
      };
    });
  }

  async pending(profileId, now = Date.now()) {
    const owner = profile(profileId);
    return this.#serialized(async () => {
      const state = await readState(this.#file);
      prune(state, now);
      return Object.values(state.requests)
        .filter(r => r.profile_id === owner && r.status === "awaiting_approval")
        .map(r => ({
          target_id: r.target_id,
          label: r.label || null,
          fingerprint: r.fingerprint,
          expires_at: new Date(r.expires_at).toISOString(),
        }));
    });
  }

  async approve({ profileId, targetId, fingerprint: expectedFingerprint }, now = Date.now()) {
    const owner = profile(profileId);
    const id = normalizeTargetId(targetId);
    if (!FINGERPRINT_RE.test(String(expectedFingerprint || ""))) {
      throw new Error("target public-key fingerprint must be confirmed");
    }
    return this.#serialized(async () => {
      const state = await readState(this.#file);
      prune(state, now);
      const match = Object.entries(state.requests).find(([, r]) =>
        r.profile_id === owner && r.target_id === id && r.status === "awaiting_approval"
      );
      if (!match) throw new Error("no pending enrollment for this profile and target");
      const [hash, request] = match;
      if (request.fingerprint !== expectedFingerprint) {
        throw new Error("target fingerprint mismatch");
      }
      if (state.targets[id]) throw new Error("target already registered");
      await this.#assertBelowLimit(state, owner);
      state.targets[id] = {
        profile_id: owner,
        public_key_pem: request.public_key_pem,
        fingerprint: request.fingerprint,
        label: request.label || null,
        connected_at: now,
        revoked_at: null,
      };
      delete state.requests[hash];
      await writeState(this.#file, state);
      return { approved: true, target_id: id, fingerprint: request.fingerprint };
    });
  }

  async list(profileId) {
    const owner = profile(profileId);
    const state = await readState(this.#file);
    return Object.entries(state.targets)
      .filter(([, item]) => item.profile_id === owner && !item.revoked_at)
      .map(([targetId, item]) => ({
        target_id: targetId,
        label: item.label || null,
        fingerprint: item.fingerprint,
        connected_at: new Date(item.connected_at).toISOString(),
      }));
  }

  // Pick one of the caller's servers by target id or (case-insensitive)
  // name. Without a selector, a single linked server is the default.
  async resolve(profileId, selector) {
    const targets = await this.list(profileId);
    const wanted = String(selector ?? "").trim();
    if (!wanted) {
      if (targets.length === 1) return targets[0];
      const err = new Error(targets.length
        ? "Several servers are linked; pass target with one of: " + targets.map(t => t.label || t.target_id).join(", ")
        : "No server is linked to this account yet. Call get_server_install_command and run the command on your VPS.");
      err.code = targets.length ? "target_selection_required" : "not_paired";
      throw err;
    }
    const byId = targets.find(t => t.target_id === wanted);
    if (byId) return byId;
    const byLabel = targets.filter(t => t.label && t.label.toLowerCase() === wanted.toLowerCase());
    if (byLabel.length === 1) return byLabel[0];
    const err = new Error(byLabel.length
      ? "More than one server is named " + wanted + "; use its target_id instead."
      : "No linked server matches " + wanted + ".");
    err.code = "unknown_target";
    throw err;
  }

  async rename(profileId, targetId, label) {
    const owner = profile(profileId);
    const id = normalizeTargetId(targetId);
    const name = normalizeTargetLabel(label);
    if (!name) throw new Error("server name must be 1-64 letters, digits, spaces, dots, dashes or underscores");
    return this.#serialized(async () => {
      const state = await readState(this.#file);
      const target = state.targets[id];
      if (!target || target.profile_id !== owner || target.revoked_at) throw new Error("no such linked server");
      target.label = name;
      await writeState(this.#file, state);
      return { renamed: true, target_id: id, label: name };
    });
  }

  async revoke(profileId, targetId, now = Date.now()) {
    const owner = profile(profileId);
    const id = normalizeTargetId(targetId);
    return this.#serialized(async () => {
      const state = await readState(this.#file);
      const target = state.targets[id];
      if (!target || target.profile_id !== owner || target.revoked_at) {
        return { revoked: false };
      }
      target.revoked_at = now;
      await writeState(this.#file, state);
      return { revoked: true, target_id: id };
    });
  }

  async trustedTarget(targetId) {
    const id = normalizeTargetId(targetId);
    const state = await readState(this.#file);
    const value = state.targets[id];
    if (!value || value.revoked_at) return null;
    return {
      target_id: id,
      profile_id: value.profile_id,
      public_key_pem: value.public_key_pem,
      fingerprint: value.fingerprint,
    };
  }
}
