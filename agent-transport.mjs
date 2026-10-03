import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeTargetId } from "./pairing.mjs";
import { newTargetSessionId } from "./target-routing.mjs";

const DEFAULT_MAX_SKEW_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_PENDING = 16;
const MAX_AGENT_BODY_BYTES = 256 * 1024;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function base64urlBuffer(value, label) {
  const raw = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error(label + " must be base64url");
  return Buffer.from(raw, "base64url");
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  if (!/^n_[A-Za-z0-9_-]{16,96}$/.test(nonce)) {
    throw new Error("agent nonce must be an opaque n_ identifier");
  }
  return nonce;
}

function normalizePathname(value) {
  const pathname = String(value || "").trim();
  if (!/^\/agent\/v1\/(session|poll|result|disconnect)$/.test(pathname)) {
    throw new Error("unsupported agent endpoint");
  }
  return pathname;
}

function keyMapFromRaw(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const candidate = parsed?.targets && typeof parsed.targets === "object" ? parsed.targets : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("agent public key config must be an object keyed by target id");
  }

  const keys = new Map();
  for (const [targetIdRaw, value] of Object.entries(candidate)) {
    const targetId = normalizeTargetId(targetIdRaw);
    const pem = typeof value === "string" ? value : value?.public_key;
    if (!String(pem || "").trim()) throw new Error("agent public key is required for " + targetId);
    const key = crypto.createPublicKey(String(pem));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("agent public key must be Ed25519 for " + targetId);
    }
    keys.set(targetId, key);
  }
  if (!keys.size) throw new Error("at least one agent public key is required");
  return keys;
}

export function agentPublicKeysFromEnv(env = process.env) {
  const inline = String(env.ZSSH_AGENT_PUBLIC_KEYS_JSON || "").trim();
  const file = String(env.ZSSH_AGENT_PUBLIC_KEYS_FILE || "").trim();
  if (inline && file) throw new Error("configure only one of ZSSH_AGENT_PUBLIC_KEYS_JSON or ZSSH_AGENT_PUBLIC_KEYS_FILE");
  if (!inline && !file) return new Map();
  const raw = inline || readFileSync(file, "utf8");
  return keyMapFromRaw(raw);
}

export function canonicalAgentRequest({
  method = "POST",
  pathname,
  targetId,
  timestamp,
  nonce,
  body = "",
} = {}) {
  const normalizedMethod = String(method || "").toUpperCase();
  if (normalizedMethod !== "POST") throw new Error("agent transport only supports POST");
  const normalizedPath = normalizePathname(pathname);
  const target = normalizeTargetId(targetId);
  const ts = String(timestamp || "").trim();
  if (!/^\d{10,13}$/.test(ts)) throw new Error("agent timestamp must be unix epoch seconds or milliseconds");
  const normalizedNonce = normalizeNonce(nonce);
  const bodyHash = crypto.createHash("sha256").update(String(body)).digest("hex");
  return ["zssh-agent-v1", normalizedMethod, normalizedPath, target, ts, normalizedNonce, bodyHash].join("\n");
}

export function signAgentRequest(privateKey, fields) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("agent private key must be Ed25519");
  const message = canonicalAgentRequest(fields);
  return crypto.sign(null, Buffer.from(message), key).toString("base64url");
}

export class AgentRequestVerifier {
  #keys;
  #seen = new Map();
  #maxSkewMs;

  constructor({ keys, maxSkewMs = DEFAULT_MAX_SKEW_MS } = {}) {
    if (!(keys instanceof Map) || !keys.size) throw new Error("agent verifier requires at least one public key");
    this.#keys = keys;
    this.#maxSkewMs = clampInt(maxSkewMs, 5_000, 300_000, DEFAULT_MAX_SKEW_MS);
  }

  verify({ method = "POST", pathname, headers = {}, body = "", now = Date.now() } = {}) {
    const targetId = normalizeTargetId(headers["x-zssh-agent-target"] || headers["X-ZSSH-Agent-Target"]);
    const timestampRaw = String(headers["x-zssh-agent-timestamp"] || headers["X-ZSSH-Agent-Timestamp"] || "").trim();
    const nonce = normalizeNonce(headers["x-zssh-agent-nonce"] || headers["X-ZSSH-Agent-Nonce"]);
    const signature = base64urlBuffer(headers["x-zssh-agent-signature"] || headers["X-ZSSH-Agent-Signature"], "agent signature");
    const publicKey = this.#keys.get(targetId);
    if (!publicKey) throw new Error("unknown agent target");

    const numeric = Number(timestampRaw);
    const timestampMs = timestampRaw.length <= 10 ? numeric * 1000 : numeric;
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > this.#maxSkewMs) {
      throw new Error("agent request timestamp is outside the allowed clock-skew window");
    }

    for (const [key, expiresAt] of this.#seen) {
      if (expiresAt <= now) this.#seen.delete(key);
    }
    const replayKey = targetId + ":" + nonce;
    if (this.#seen.has(replayKey)) throw new Error("agent request replay detected");

    const message = canonicalAgentRequest({
      method,
      pathname,
      targetId,
      timestamp: timestampRaw,
      nonce,
      body,
    });
    if (!crypto.verify(null, Buffer.from(message), publicKey, signature)) {
      throw new Error("invalid agent request signature");
    }

    this.#seen.set(replayKey, now + this.#maxSkewMs);
    return { target_id: targetId };
  }
}

export function createAgentRequestVerifier(env = process.env) {
  const keys = agentPublicKeysFromEnv(env);
  return keys.size ? new AgentRequestVerifier({
    keys,
    maxSkewMs: env.ZSSH_AGENT_MAX_CLOCK_SKEW_MS,
  }) : null;
}

function safePayloadSize(value) {
  const encoded = Buffer.from(JSON.stringify(value ?? null));
  if (encoded.length > MAX_AGENT_BODY_BYTES) throw new Error("agent payload exceeds size limit");
  return encoded.length;
}

function safeRequestId(value) {
  const id = String(value || "").trim();
  if (!/^req_[A-Za-z0-9_-]{16,96}$/.test(id)) throw new Error("invalid agent request id");
  return id;
}

function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!/^sess_[A-Za-z0-9_-]{12,96}$/.test(id)) throw new Error("invalid agent session id");
  return id;
}

export class OutboundAgentBroker {
  #sessions;
  #targets = new Map();
  #requestTimeoutMs;
  #pollTimeoutMs;
  #maxPending;

  constructor({
    sessions,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    maxPending = DEFAULT_MAX_PENDING,
  } = {}) {
    if (!sessions || typeof sessions.register !== "function" || typeof sessions.unregister !== "function") {
      throw new Error("target session registry is required");
    }
    this.#sessions = sessions;
    this.#requestTimeoutMs = clampInt(requestTimeoutMs, 1_000, 120_000, DEFAULT_REQUEST_TIMEOUT_MS);
    this.#pollTimeoutMs = clampInt(pollTimeoutMs, 1_000, 30_000, DEFAULT_POLL_TIMEOUT_MS);
    this.#maxPending = clampInt(maxPending, 1, 128, DEFAULT_MAX_PENDING);
  }

  open(targetId) {
    const target = normalizeTargetId(targetId);
    const existing = this.#targets.get(target);
    if (existing) this.#closeState(target, existing, "agent session replaced");

    const sessionId = newTargetSessionId();
    const state = {
      target_id: target,
      session_id: sessionId,
      queue: [],
      pending: new Map(),
      poll_waiter: null,
    };
    this.#targets.set(target, state);

    this.#sessions.register({
      targetId: target,
      sessionId,
      transport: payload => this.dispatch(target, sessionId, payload),
    });
    return { target_id: target, session_id: sessionId };
  }

  async dispatch(targetId, sessionId, payload) {
    const state = this.#requireSession(targetId, sessionId);
    safePayloadSize(payload);
    if (state.pending.size >= this.#maxPending) throw new Error("agent target has too many pending requests");

    const requestId = "req_" + crypto.randomBytes(18).toString("base64url");
    const envelope = { request_id: requestId, payload };
    let timer;

    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error("agent request timed out"));
      }, this.#requestTimeoutMs);
      timer.unref?.();
      state.pending.set(requestId, { resolve, reject, timer });
    });

    if (state.poll_waiter) {
      const waiter = state.poll_waiter;
      state.poll_waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(envelope);
    } else {
      state.queue.push(envelope);
    }
    return await promise;
  }

  async next(targetId, sessionId) {
    const state = this.#requireSession(targetId, sessionId);
    if (state.queue.length) return state.queue.shift();
    if (state.poll_waiter) throw new Error("only one active long poll is allowed per agent session");

    return await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (state.poll_waiter?.resolve === resolve) state.poll_waiter = null;
        resolve(null);
      }, this.#pollTimeoutMs);
      timer.unref?.();
      state.poll_waiter = { resolve, timer };
    });
  }

  complete(targetId, sessionId, requestId, result) {
    const state = this.#requireSession(targetId, sessionId);
    const id = safeRequestId(requestId);
    safePayloadSize(result);
    const pending = state.pending.get(id);
    if (!pending) throw new Error("unknown or expired agent request");
    state.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(result);
    return { accepted: true, request_id: id };
  }

  close(targetId, sessionId) {
    const target = normalizeTargetId(targetId);
    const state = this.#targets.get(target);
    if (!state || state.session_id !== safeSessionId(sessionId)) return false;
    this.#closeState(target, state, "agent disconnected");
    return true;
  }

  snapshot() {
    return [...this.#targets.values()].map(state => ({
      target_id: state.target_id,
      session_id: state.session_id,
      queued: state.queue.length,
      pending: state.pending.size,
    })).sort((a, b) => a.target_id.localeCompare(b.target_id));
  }

  #requireSession(targetId, sessionId) {
    const target = normalizeTargetId(targetId);
    const session = safeSessionId(sessionId);
    const state = this.#targets.get(target);
    if (!state || state.session_id !== session) throw new Error("agent session is not active");
    return state;
  }

  #closeState(targetId, state, reason) {
    this.#targets.delete(targetId);
    this.#sessions.unregister(targetId, state.session_id);
    if (state.poll_waiter) {
      clearTimeout(state.poll_waiter.timer);
      state.poll_waiter.resolve(null);
      state.poll_waiter = null;
    }
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    state.pending.clear();
    state.queue.length = 0;
  }
}

export async function readJsonBody(req, { maxBytes = MAX_AGENT_BODY_BYTES } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("agent request body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let value = {};
  if (raw) value = JSON.parse(raw);
  return { raw, value };
}

export const AGENT_ENDPOINTS = Object.freeze([
  "/agent/v1/session",
  "/agent/v1/poll",
  "/agent/v1/result",
  "/agent/v1/disconnect",
]);
