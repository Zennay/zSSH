import crypto from "node:crypto";
import { readFileSync, promises as fs } from "node:fs";
import { normalizeTargetId } from "./pairing.mjs";
import { TargetSessionRegistry, newTargetSessionId } from "./target-routing.mjs";

export const PUBLIC_TARGET_TOOLS = Object.freeze([
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

function parseAgentTrustFile(raw) {
  const parsed = JSON.parse(String(raw || ""));
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

export async function loadAgentTrustFile(file) {
  const filename = String(file || "").trim();
  if (!filename) throw new Error("agent trust file is required");
  return parseAgentTrustFile(await fs.readFile(filename, "utf8"));
}

export function loadAgentTrustFileSync(file) {
  const filename = String(file || "").trim();
  if (!filename) throw new Error("agent trust file is required");
  return parseAgentTrustFile(readFileSync(filename, "utf8"));
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

export class OutboundAgentBroker {
  #sessions;
  #states = new Map();
  #allowedTools;
  #commandTimeoutMs;
  #maxPayloadBytes;

  constructor({
    sessions,
    allowedTools = PUBLIC_TARGET_TOOLS,
    commandTimeoutMs = 30000,
    maxPayloadBytes = 131072,
  } = {}) {
    if (!(sessions instanceof TargetSessionRegistry)) {
      throw new Error("target session registry is required");
    }

    const toolNames = [...new Set(Array.from(allowedTools || []).map(value => String(value).trim()).filter(Boolean))];
    if (!toolNames.length || toolNames.some(name => !/^[A-Za-z0-9_.:-]{1,96}$/.test(name))) {
      throw new Error("agent tool allowlist is invalid");
    }

    const timeout = Number(commandTimeoutMs);
    const maxBytes = Number(maxPayloadBytes);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) {
      throw new Error("agent command timeout must be between 1000 and 300000 ms");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 1048576) {
      throw new Error("agent payload limit must be between 4096 and 1048576 bytes");
    }

    this.#sessions = sessions;
    this.#allowedTools = new Set(toolNames);
    this.#commandTimeoutMs = timeout;
    this.#maxPayloadBytes = maxBytes;
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

  complete(targetId, sessionId, envelope) {
    const state = this.#current(targetId, sessionId);
    const requestId = normalizeRequestId(envelope?.request_id);
    const pending = state.pending.get(requestId);
    if (!pending) throw new Error("agent response does not match a pending request");

    const response = envelope?.error
      ? { ok: false, error: String(envelope.error).slice(0, 2048) }
      : envelope?.result;
    serializeBounded(response, this.#maxPayloadBytes, "agent response");

    clearTimeout(pending.timer);
    state.pending.delete(requestId);
    pending.resolve(response);
    return { accepted: true, request_id: requestId };
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
