import {
  AgentReplayCache,
  OutboundAgentBroker,
  verifySignedAgentRequest,
} from "./agent-transport.mjs";

const AGENT_PATHS = new Set([
  "/agent/v1/connect",
  "/agent/v1/poll",
  "/agent/v1/result",
  "/agent/v1/disconnect",
]);

function headerValue(req, name) {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

async function readBoundedBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > maxBytes) {
      const error = new Error("agent request body exceeds size limit");
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
}

function parseObjectBody(raw) {
  let value;
  try {
    value = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    throw new Error("agent request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("agent request body must be a JSON object");
  }
  return value;
}

function classifyAgentError(error) {
  const message = String(error?.message || error || "");
  if (
    /not current|does not match a pending request|only one long poll/i.test(message)
  ) return 409;
  if (/body exceeds size limit/i.test(message)) return 413;
  return 400;
}

export function createAgentHttpHandler({
  trustedKeys,
  replayCache = new AgentReplayCache(),
  broker,
  maxBodyBytes = 262144,
  maxClockSkewSeconds = 60,
  now = () => Date.now(),
} = {}) {
  if (!(trustedKeys instanceof Map) || !trustedKeys.size) {
    throw new Error("agent HTTP handler requires trusted target keys");
  }
  if (!(replayCache instanceof AgentReplayCache)) {
    throw new Error("agent HTTP handler requires a replay cache");
  }
  if (!(broker instanceof OutboundAgentBroker)) {
    throw new Error("agent HTTP handler requires an outbound agent broker");
  }

  return async function handleAgentHttp(req, res, url) {
    const pathname = String(url?.pathname || "");
    if (!pathname.startsWith("/agent/")) return false;

    if (!AGENT_PATHS.has(pathname)) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
      return true;
    }

    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      sendJson(res, 415, { error: "application_json_required" });
      return true;
    }

    let raw;
    try {
      raw = await readBoundedBody(req, maxBodyBytes);
    } catch (error) {
      sendJson(res, error?.code === "body_too_large" ? 413 : 400, { error: "invalid_request" });
      return true;
    }

    let verified;
    try {
      verified = verifySignedAgentRequest({
        method: req.method,
        requestPath: pathname,
        targetId: headerValue(req, "x-zssh-target-id"),
        timestamp: headerValue(req, "x-zssh-agent-timestamp"),
        nonce: headerValue(req, "x-zssh-agent-nonce"),
        signature: headerValue(req, "x-zssh-agent-signature"),
        body: raw,
        trustedKeys,
        replayCache,
        now: now(),
        maxClockSkewSeconds,
        maxBodyBytes,
      });
    } catch {
      sendJson(res, 401, { error: "agent_authentication_failed" });
      return true;
    }

    let body;
    try {
      body = parseObjectBody(raw);
    } catch (error) {
      sendJson(res, 400, { error: "invalid_request", detail: String(error.message || error) });
      return true;
    }

    try {
      const targetId = verified.target_id;

      if (pathname === "/agent/v1/connect") {
        const connected = broker.connect(targetId, { sessionId: body.session_id, now: now() });
        sendJson(res, 200, {
          ok: true,
          target_id: connected.target_id,
          session_id: connected.session_id,
          connected_at: connected.connected_at,
        });
        return true;
      }

      if (pathname === "/agent/v1/poll") {
        const command = await broker.pull(targetId, body.session_id, {
          waitMs: body.wait_ms === undefined ? 25000 : body.wait_ms,
        });
        sendJson(res, 200, command);
        return true;
      }

      if (pathname === "/agent/v1/result") {
        const accepted = broker.complete(targetId, body.session_id, {
          request_id: body.request_id,
          result: body.result,
          error: body.error,
        });
        sendJson(res, 200, { ok: true, ...accepted });
        return true;
      }

      const disconnected = broker.disconnect(targetId, body.session_id, "target agent disconnected");
      if (!disconnected) {
        sendJson(res, 409, { error: "agent_session_not_current" });
        return true;
      }
      sendJson(res, 200, { ok: true, disconnected: true });
      return true;
    } catch (error) {
      const status = classifyAgentError(error);
      sendJson(res, status, {
        error: status === 409 ? "agent_session_conflict" : "invalid_agent_request",
      });
      return true;
    }
  };
}
