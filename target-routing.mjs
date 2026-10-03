import crypto from "node:crypto";
import { getPairingStatus, normalizeTargetId, targetIdFromEnv } from "./pairing.mjs";

function safeSessionId(value) {
  const id = String(value || "").trim();
  if (!/^sess_[A-Za-z0-9_-]{12,96}$/.test(id)) {
    throw new Error("session id must be an opaque sess_ identifier");
  }
  return id;
}

export class TargetSessionRegistry {
  #sessions = new Map();

  register({ targetId, sessionId, transport, now = Date.now() } = {}) {
    const id = normalizeTargetId(targetId);
    const session = safeSessionId(sessionId);
    if (typeof transport !== "function") {
      throw new Error("transport must be an authenticated live-session function");
    }

    const connectedAt = new Date(now).toISOString();
    this.#sessions.set(id, {
      target_id: id,
      session_id: session,
      connected_at: connectedAt,
      transport,
    });

    return {
      target_id: id,
      session_id: session,
      connected_at: connectedAt,
    };
  }

  unregister(targetId, sessionId) {
    const id = normalizeTargetId(targetId);
    const current = this.#sessions.get(id);
    if (!current) return false;
    if (sessionId && current.session_id !== safeSessionId(sessionId)) return false;
    this.#sessions.delete(id);
    return true;
  }

  resolve(targetId) {
    const id = normalizeTargetId(targetId);
    const current = this.#sessions.get(id);
    if (!current) return null;
    return {
      target_id: current.target_id,
      session_id: current.session_id,
      connected_at: current.connected_at,
      send: current.transport,
    };
  }

  snapshot() {
    return [...this.#sessions.values()]
      .map(({ target_id, session_id, connected_at }) => ({
        target_id,
        session_id,
        connected_at,
      }))
      .sort((a, b) => a.target_id.localeCompare(b.target_id));
  }
}

export function newTargetSessionId() {
  return "sess_" + crypto.randomBytes(18).toString("base64url");
}

export async function resolveAuthenticatedTarget(authInfo, {
  resource = "",
  env = process.env,
  now = Date.now(),
  sessions,
} = {}) {
  if (!(sessions instanceof TargetSessionRegistry)) {
    throw new Error("target session registry is required");
  }

  const targetId = targetIdFromEnv(env);
  const pairing = await getPairingStatus(authInfo, {
    resource,
    env,
    now,
    targetId,
    createRequest: false,
  });

  if (!pairing.paired) {
    return {
      routable: false,
      reason: pairing.pending ? "pairing_pending" : "not_paired",
      profile_id: pairing.profile_id,
      target_id: targetId,
    };
  }

  const live = sessions.resolve(pairing.target_id);
  if (!live) {
    return {
      routable: false,
      reason: "target_offline",
      profile_id: pairing.profile_id,
      target_id: pairing.target_id,
    };
  }

  return {
    routable: true,
    profile_id: pairing.profile_id,
    target_id: pairing.target_id,
    session_id: live.session_id,
    send: live.send,
  };
}
