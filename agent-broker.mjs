import crypto from "node:crypto";
import { normalizeTargetId } from "./pairing.mjs";

function validateToolName(value) {
  const tool = String(value || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(tool)) {
    throw new Error("broker tool name is invalid");
  }
  return tool;
}

function validateArgs(value, maxBytes) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("broker args must be an object");
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new Error("broker args exceed maximum bytes");
  }
  return structuredClone(value);
}

export class AgentRequestBroker {
  #queues = new Map();
  #pending = new Map();

  constructor({
    maxPendingTotal = 128,
    maxPendingPerTarget = 16,
    maxArgsBytes = 65536,
    defaultTimeoutMs = 30000,
  } = {}) {
    this.maxPendingTotal = maxPendingTotal;
    this.maxPendingPerTarget = maxPendingPerTarget;
    this.maxArgsBytes = maxArgsBytes;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  request(targetId, toolName, args = {}, { timeoutMs = this.defaultTimeoutMs } = {}) {
    const target = normalizeTargetId(targetId);
    if (target === "local") throw new Error("broker requests require an explicit opaque target id");
    const tool = validateToolName(toolName);
    const payload = validateArgs(args, this.maxArgsBytes);
    const boundedTimeout = Number(timeoutMs);
    if (!Number.isInteger(boundedTimeout) || boundedTimeout < 50 || boundedTimeout > 300000) {
      throw new Error("broker timeout must be between 50 and 300000 ms");
    }

    if (this.#pending.size >= this.maxPendingTotal) {
      throw new Error("broker global pending limit reached");
    }
    const targetPending = [...this.#pending.values()].filter(entry => entry.target_id === target).length;
    if (targetPending >= this.maxPendingPerTarget) {
      throw new Error("broker target pending limit reached");
    }

    const requestId = "req_" + crypto.randomBytes(18).toString("base64url");
    let timer;
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const current = this.#pending.get(requestId);
        if (!current) return;
        this.#pending.delete(requestId);
        const queue = this.#queues.get(target) || [];
        this.#queues.set(target, queue.filter(id => id !== requestId));
        reject(new Error("target agent request timed out"));
      }, boundedTimeout);
      timer.unref?.();

      this.#pending.set(requestId, {
        request_id: requestId,
        target_id: target,
        tool,
        args: payload,
        created_at: new Date().toISOString(),
        resolve,
        reject,
        timer,
      });
      const queue = this.#queues.get(target) || [];
      queue.push(requestId);
      this.#queues.set(target, queue);
    });

    return { request_id: requestId, result };
  }

  takeNext(targetId) {
    const target = normalizeTargetId(targetId);
    const queue = this.#queues.get(target) || [];
    while (queue.length) {
      const requestId = queue.shift();
      const current = this.#pending.get(requestId);
      if (!current) continue;
      this.#queues.set(target, queue);
      return {
        request_id: current.request_id,
        target_id: current.target_id,
        tool: current.tool,
        args: structuredClone(current.args),
        created_at: current.created_at,
      };
    }
    this.#queues.set(target, queue);
    return null;
  }

  complete(targetId, requestId, value) {
    const target = normalizeTargetId(targetId);
    const id = String(requestId || "").trim();
    const current = this.#pending.get(id);
    if (!current || current.target_id !== target) return false;
    clearTimeout(current.timer);
    this.#pending.delete(id);
    current.resolve(structuredClone(value));
    return true;
  }

  fail(targetId, requestId, message = "target agent request failed") {
    const target = normalizeTargetId(targetId);
    const id = String(requestId || "").trim();
    const current = this.#pending.get(id);
    if (!current || current.target_id !== target) return false;
    clearTimeout(current.timer);
    this.#pending.delete(id);
    current.reject(new Error(String(message || "target agent request failed").slice(0, 512)));
    return true;
  }

  disconnectTarget(targetId) {
    const target = normalizeTargetId(targetId);
    let failed = 0;
    for (const [requestId, current] of [...this.#pending.entries()]) {
      if (current.target_id !== target) continue;
      clearTimeout(current.timer);
      this.#pending.delete(requestId);
      current.reject(new Error("target agent disconnected"));
      failed += 1;
    }
    this.#queues.delete(target);
    return failed;
  }

  snapshot() {
    const byTarget = {};
    for (const entry of this.#pending.values()) {
      byTarget[entry.target_id] = (byTarget[entry.target_id] || 0) + 1;
    }
    return {
      pending_total: this.#pending.size,
      pending_by_target: Object.fromEntries(Object.entries(byTarget).sort(([a], [b]) => a.localeCompare(b))),
    };
  }
}
