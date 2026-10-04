import { approvePairing, listPairings, normalizeTargetId, revokePairing } from "./pairing.mjs";

export const AGENT_PAIRING_ENDPOINTS = Object.freeze([
  "/agent/v1/pairings",
  "/agent/v1/pairing/approve",
  "/agent/v1/pairing/revoke",
]);

const REQUEST_ID_RE = /^pair_[a-f0-9]{24}$/;
const PROFILE_ID_RE = /^zssh_[a-f0-9]{32}$/;

function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent pairing request body must be an object");
  }
  return value;
}

export async function executeAgentPairingControl({
  pathname,
  targetId,
  body = {},
  env = process.env,
} = {}) {
  const target = normalizeTargetId(targetId);
  const value = objectBody(body);

  if (pathname === "/agent/v1/pairings") {
    return await listPairings({ targetId: target, env });
  }

  if (pathname === "/agent/v1/pairing/approve") {
    const requestId = String(value.request_id || "").trim();
    if (!REQUEST_ID_RE.test(requestId)) throw new Error("invalid pairing request id");
    return await approvePairing(requestId, { targetId: target, env });
  }

  if (pathname === "/agent/v1/pairing/revoke") {
    const profileId = String(value.profile_id || "").trim();
    if (!PROFILE_ID_RE.test(profileId)) throw new Error("invalid pairing profile id");
    return await revokePairing(profileId, { targetId: target, env });
  }

  throw new Error("unsupported agent pairing endpoint");
}
