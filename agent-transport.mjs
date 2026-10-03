import crypto from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { normalizeTargetId } from "./pairing.mjs";
import { TargetSessionRegistry, newTargetSessionId } from "./target-routing.mjs";

export const PUBLIC_TARGET_TOOLS = Object.freeze([
  "zssh_server_info",
  "get_system_uptime",
  "get_system_identity",
  "get_kernel_info",
  "get_disk_usage",
  "get_memory_usage",
  "zssh_read_file",
  "zssh_write_file",
]);

const SESSION_RE = /^sess_[A-Za-z0-9_-]{12,96}$/;
const NONCE_RE = /^nonce_[A-Za-z0-9_-]{16,96}$/;
const REQUEST_RE = /^rpc_[A-Za-z0-9_-]{12,96}$/;

function normalizeSessionId(value) {
  const id = String(value || "").trim();
  if (!SESSION_RE.test(id)) throw new Error("invalid agent session id");
  return id;
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  if (!NONCE_RE.test(nonce)) throw new Error("invalid agent nonce");
  return nonce;
}

function normalizeRequestId(value) {
  const id = String(value || "").trim();
  if (!REQUEST_RE.test(id)) throw new Error("invalid agent request id");
  return id;
}

function serializeBounded(value, maxBytes, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(label + " must be JSON serializable");
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new Error(label + " exceeds size limit");
  }
  return encoded;
}

export function canonicalAgentRequest({
  method,
  requestPath,
  targetId,
  timestamp,
  nonce,
  body = "",
}) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  if (!/^(GET|POST|PUT|DELETE)$/.test(normalizedMethod)) {
    throw new Error("unsupported agent request method");
  }

  const normalizedPath = String(requestPath || "").trim();
  if (!normalizedPath.startsWith("/agent/") || normalizedPath.includes("\n") || normalizedPath.includes("\r")) {
    throw new Error("invalid agent request path");
  }

  const id = normalizeTargetId(targetId);
  const unixSeconds = Number(timestamp);
  if (!Number.isInteger(unixSeconds) || unixSeconds <= 0) {
    throw new Error("invalid agent request timestamp");
  }

  const safeNonce = normalizeNonce(nonce);
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const bodyHash = crypto.createHash("sha256").update(bodyBuffer).digest("hex");

  return [
    "zssh-agent-v1",
    normalizedMethod,
    normalizedPath,
    id,
    String(unixSeconds),
    safeNonce,
    bodyHash,
  ].join("\n");
}

export class AgentReplayCache {
  #seen = new Map();

  consume(targetId, nonce, expiresAtMs, now = Date.now()) {
    const id = normalizeTargetId(targetId);
    const safeNonce = normalizeNonce(nonce);
    const expiry = Number(expiresAtMs);
    if (!Number.isFinite(expiry) || expiry <= now) {
      throw new Error("agent nonce already expired");
    }

    for (const [key, value] of this.#seen.entries()) {
      if (value <= now) this.#seen.delete(key);
    }

    const key = id + "::" + safeNonce;
    if (this.#seen.has(key)) throw new Error("agent request replay detected");
    this.#seen.set(key, expiry);
  }

  size(now = Date.now()) {
    for (const [key, value] of this.#seen.entries()) {
      if (value <= now) this.#seen.delete(key);
    }
    return this.#seen.size;
  }
}

export async function loadAgentTrustFile(file) {
  const filename = String(file || "").trim();
  if (!filename) throw new Error("agent trust file is required");

  const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
  if (parsed?.version !== 1 || !parsed.targets || typeof parsed.targets !== "object" || Array.isArray(parsed.targets)) {
    throw new Error("invalid agent trust file");
  }

  const entries = Object.entries(parsed.targets);
  if (!entries.length || entries.length > 256) {
    throw new Error("agent trust file must contain between 1 and 256 targets");
  }

  const trusted = new Map();
  for (const [rawTargetId, record] of entries) {
    const targetId = normalizeTargetId(rawTargetId);
    if (record?.enabled === false) continue;
    const pem = String(record?.public_key_pem || "");
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
      throw new Error("agent public key must be PEM SubjectPublicKeyInfo");
    }
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("agent public key must use Ed25519");
    }
    trusted.set(targetId, key);
  }

  if (!trusted.size) throw new Error("agent trust file has no enabled targets");
  return trusted;
}

export function verifySignedAgentRequest({
  method,
  requestPath,
  targetId,
  timestamp,
  nonce,
  signature,
  body = "",
  trustedKeys,
  replayCache,
  now = Date.now(),
  maxClockSkewSeconds = 60,
  maxBodyBytes = 262144,
}) {
  if (!(trustedKeys instanceof Map)) throw new Error("trusted agent keys are required");
  if (!(replayCache instanceof AgentReplayCache)) throw new Error("agent replay cache is required");

  const id = normalizeTargetId(targetId);
  const key = trustedKeys.get(id);
  if (!key) throw new Error("agent target is not trusted");

  const unixSeconds = Number(timestamp);
  if (!Number.isInteger(unixSeconds)) throw new Error("invalid agent request timestamp");
  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - unixSeconds) > maxClockSkewSeconds) {
    throw new Error("agent request timestamp is outside allowed clock skew");
  }

  const safeNonce = normalizeNonce(nonce);
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  if (bodyBuffer.length > maxBodyBytes) throw new Error("agent request body exceeds size limit");

  const rawSignature = String(signature || "").trim();
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(rawSignature)) {
    throw new Error("invalid agent request signature");
  }

  const canonical = canonicalAgentRequest({
    method,
    requestPath,
    targetId: id,
    timestamp: unixSeconds,
    nonce: safeNonce,
    body: bodyBuffer,
  });
  const valid = crypto.verify(
    null,
    Buffer.from(canonical, "utf8"),
    key,
    Buffer.from(rawSignature, "base64url"),
  );
  if (!valid) throw new Error("agent request signature verification failed");

  replayCache.consume(
    id,
    safeNonce,
    (unixSeconds + maxClockSkewSeconds + 1) * 1000,
    now,
  );

  return { target_id: id, authenticated: true };
}


function parseAgentPublicKeys(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const candidate = parsed?.targets && typeof parsed.targets === "object" ? parsed.targets : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("agent public key config must be an object keyed by target id");
  }

  const entries = Object.entries(candidate);
  if (!entries.length || entries.length > 256) {
    throw new Error("agent public key config must contain between 1 and 256 targets");
  }

  const trusted = new Map();
  for (const [rawTargetId, record] of entries) {
    const targetId = normalizeTargetId(rawTargetId);
    if (record?.enabled === false) continue;
    const pem = typeof record === "string"
      ? record
      : String(record?.public_key_pem || record?.public_key || "");
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) {
      throw new Error("agent public key must be PEM SubjectPublicKeyInfo");
    }
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("agent public key must use Ed25519");
    }
    trusted.set(targetId, key);
  }
  if (!trusted.size) throw new Error("agent public key config has no enabled targets");
  return trusted;
}

export function agentPublicKeysFromEnv(env = process.env) {
  const inline = String(env.ZSSH_AGENT_PUBLIC_KEYS_JSON || "").trim();
  const file = String(env.ZSSH_AGENT_PUBLIC_KEYS_FILE || "").trim();
  if (inline && file) {
    throw new Error("configure only one of ZSSH_AGENT_PUBLIC_KEYS_JSON or ZSSH_AGENT_PUBLIC_KEYS_FILE");
  }
  if (!inline && !file) return new Map();
  return parseAgentPublicKeys(inline || readFileSync(file, "utf8"));
}

export function signAgentRequest(privateKey, {
  method = "POST",
  pathname,
  targetId,
  timestamp,
  nonce,
  body = "",
} = {}) {
  const key = privateKey?.type === "private" && typeof privateKey?.export === "function"
    ? privateKey
    : crypto.createPrivateKey(privateKey);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("agent private key must use Ed25519");
  }
  const numeric = Number(timestamp);
  const unixSeconds = Number.isInteger(numeric) && numeric > 100000000000
    ? Math.floor(numeric / 1000)
    : numeric;
  const canonical = canonicalAgentRequest({
    method,
    requestPath: pathname,
    targetId,
    timestamp: unixSeconds,
    nonce,
    body,
  });
  return crypto.sign(null, Buffer.from(canonical, "utf8"), key).toString("base64url");
}

export class AgentRequestVerifier {
  #trustedKeys;
  #replayCache = new AgentReplayCache();
  #maxClockSkewSeconds;

  constructor({ keys, maxSkewMs = 60000 } = {}) {
    if (!(keys instanceof Map) || !keys.size) {
      throw new Error("agent verifier requires at least one public key");
    }
    const skew = Number(maxSkewMs);
    if (!Number.isInteger(skew) || skew < 5000 || skew > 300000) {
      throw new Error("agent max clock skew must be between 5000 and 300000 ms");
    }
    this.#trustedKeys = keys;
    this.#maxClockSkewSeconds = Math.ceil(skew / 1000);
  }

  verify({ method = "POST", pathname, headers = {}, body = "", now = Date.now() } = {}) {
    return verifySignedAgentRequest({
      method,
      requestPath: pathname,
      targetId: headers["x-zssh-agent-target"] || headers["X-ZSSH-Agent-Target"],
      timestamp: headers["x-zssh-agent-timestamp"] || headers["X-ZSSH-Agent-Timestamp"],
      nonce: headers["x-zssh-agent-nonce"] || headers["X-ZSSH-Agent-Nonce"],
      signature: headers["x-zssh-agent-signature"] || headers["X-ZSSH-Agent-Signature"],
      body,
      trustedKeys: this.#trustedKeys,
      replayCache: this.#replayCache,
      now,
      maxClockSkewSeconds: this.#maxClockSkewSeconds,
    });
  }
}

export function createAgentRequestVerifier(env = process.env) {
  const keys = agentPublicKeysFromEnv(env);
  return keys.size ? new AgentRequestVerifier({
    keys,
    maxSkewMs: Number(env.ZSSH_AGENT_MAX_CLOCK_SKEW_MS || 60000),
  }) : null;
}

export async function readJsonBody(req, { maxBytes = 262144 } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("agent request body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const value = raw ? JSON.parse(raw) : {};
  return { raw, value };
}

export const AGENT_ENDPOINTS = Object.freeze([
  "/agent/v1/session",
  "/agent/v1/poll",
  "/agent/v1/result",
  "/agent/v1/disconnect",
]);

export class OutboundAgentBroker {
  #sessions;
  #states = new Map();
  #allowedTools;
  #commandTimeoutMs;
  #pollTimeoutMs;
  #maxPayloadBytes;
  #maxPending;

  constructor({
    sessions,
    allowedTools = PUBLIC_TARGET_TOOLS,
    commandTimeoutMs,
    requestTimeoutMs,
    pollTimeoutMs = 25000,
    maxPayloadBytes = 131072,
    maxPending = 16,
  } = {}) {
    if (!(sessions instanceof TargetSessionRegistry)) {
      throw new Error("target session registry is required");
    }

    const toolNames = [...new Set(Array.from(allowedTools || []).map(value => String(value).trim()).filter(Boolean))];
    if (!toolNames.length || toolNames.some(name => !/^[A-Za-z0-9_.:-]{1,96}$/.test(name))) {
      throw new Error("agent tool allowlist is invalid");
    }

    const timeout = Number(commandTimeoutMs ?? requestTimeoutMs ?? 30000);
    const pollWait = Number(pollTimeoutMs);
    const maxBytes = Number(maxPayloadBytes);
    const pendingLimit = Number(maxPending);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) {
      throw new Error("agent command timeout must be between 1000 and 300000 ms");
    }
    if (!Number.isInteger(pollWait) || pollWait < 1000 || pollWait > 30000) {
      throw new Error("agent poll timeout must be between 1000 and 30000 ms");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 1048576) {
      throw new Error("agent payload limit must be between 4096 and 1048576 bytes");
    }
    if (!Number.isInteger(pendingLimit) || pendingLimit < 1 || pendingLimit > 128) {
      throw new Error("agent pending limit must be between 1 and 128");
    }

    this.#sessions = sessions;
    this.#allowedTools = new Set(toolNames);
    this.#commandTimeoutMs = timeout;
    this.#pollTimeoutMs = pollWait;
    this.#maxPayloadBytes = maxBytes;
    this.#maxPending = pendingLimit;
  }

  open(targetId) {
    return this.connect(targetId);
  }

  connect(targetId, { sessionId = newTargetSessionId(), now = Date.now() } = {}) {
    const id = normalizeTargetId(targetId);
    const session = normalizeSessionId(sessionId);

    const previous = this.#states.get(id);
    if (previous) this.disconnect(id, previous.session_id, "replaced by a newer agent session");

    const state = {
      target_id: id,
      session_id: session,
      connected_at: new Date(now).toISOString(),
      queue: [],
      pending: new Map(),
      poll_waiter: null,
    };
    this.#states.set(id, state);

    return this.#sessions.register({
      targetId: id,
      sessionId: session,
      now,
      transport: payload => this.#enqueue(id, session, payload),
    });
  }

  #current(targetId, sessionId) {
    const id = normalizeTargetId(targetId);
    const session = normalizeSessionId(sessionId);
    const state = this.#states.get(id);
    if (!state || state.session_id !== session) {
      throw new Error("agent session is not current");
    }
    return state;
  }

  async #enqueue(targetId, sessionId, payload) {
    const state = this.#current(targetId, sessionId);
    const tool = String(payload?.tool || "").trim();
    if (!this.#allowedTools.has(tool)) throw new Error("tool is not allowed on public target transport");
    const args = payload?.args ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("agent tool arguments must be an object");
    }

    if (state.pending.size >= this.#maxPending) {
      throw new Error("agent target has too many pending requests");
    }

    const requestId = "rpc_" + crypto.randomBytes(18).toString("base64url");
    const command = {
      type: "tool_call",
      request_id: requestId,
      tool,
      args,
    };
    serializeBounded(command, this.#maxPayloadBytes, "agent command");

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error("target agent request timed out"));
      }, this.#commandTimeoutMs);
      timer.unref?.();

      state.pending.set(requestId, { resolve, reject, timer });

      if (state.poll_waiter) {
        const waiter = state.poll_waiter;
        state.poll_waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(command);
      } else {
        state.queue.push(command);
      }
    });
  }

  async next(targetId, sessionId) {
    const command = await this.pull(targetId, sessionId, { waitMs: this.#pollTimeoutMs });
    return command?.type === "idle" ? null : command;
  }

  async pull(targetId, sessionId, { waitMs = 25000 } = {}) {
    const state = this.#current(targetId, sessionId);
    if (state.queue.length) return state.queue.shift();

    const wait = Number(waitMs);
    if (!Number.isInteger(wait) || wait < 0 || wait > 30000) {
      throw new Error("agent poll wait must be between 0 and 30000 ms");
    }
    if (wait === 0) return { type: "idle" };
    if (state.poll_waiter) throw new Error("only one long poll is allowed per agent session");

    return await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (state.poll_waiter?.resolve === resolve) state.poll_waiter = null;
        resolve({ type: "idle" });
      }, wait);
      timer.unref?.();
      state.poll_waiter = { resolve, timer };
    });
  }

  complete(targetId, sessionId, envelopeOrRequestId, directResult) {
    const envelope = typeof envelopeOrRequestId === "string"
      ? { request_id: envelopeOrRequestId, result: directResult }
      : envelopeOrRequestId;
    const state = this.#current(targetId, sessionId);
    const requestId = normalizeRequestId(envelope?.request_id);
    const pending = state.pending.get(requestId);
    if (!pending) throw new Error("agent response does not match a pending request");

    const response = envelope?.error
      ? { ok: false, error: String(envelope.error).slice(0, 2048) }
      : envelope?.result;
    if (response === undefined) throw new Error("agent result is required");
    serializeBounded(response, this.#maxPayloadBytes, "agent response");

    clearTimeout(pending.timer);
    state.pending.delete(requestId);
    pending.resolve(response);
    return { accepted: true, request_id: requestId };
  }

  close(targetId, sessionId) {
    return this.disconnect(targetId, sessionId);
  }

  disconnect(targetId, sessionId, reason = "target agent disconnected") {
    const id = normalizeTargetId(targetId);
    const session = normalizeSessionId(sessionId);
    const state = this.#states.get(id);
    if (!state || state.session_id !== session) return false;

    if (state.poll_waiter) {
      clearTimeout(state.poll_waiter.timer);
      state.poll_waiter.resolve({ type: "disconnected" });
      state.poll_waiter = null;
    }

    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(String(reason).slice(0, 200)));
    }
    state.pending.clear();
    state.queue.length = 0;

    this.#states.delete(id);
    this.#sessions.unregister(id, session);
    return true;
  }

  snapshot() {
    return [...this.#states.values()]
      .map(state => ({
        target_id: state.target_id,
        session_id: state.session_id,
        connected_at: state.connected_at,
        queued_commands: state.queue.length,
        pending_commands: state.pending.size,
      }))
      .sort((a, b) => a.target_id.localeCompare(b.target_id));
  }
}
