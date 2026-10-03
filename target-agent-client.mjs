import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import {
  PUBLIC_TARGET_TOOLS,
  canonicalAgentRequest,
} from "./agent-transport.mjs";
import {
  newTargetSessionId,
} from "./target-routing.mjs";
import { normalizeTargetId } from "./pairing.mjs";

const ALLOWED_TOOLS = new Set(PUBLIC_TARGET_TOOLS);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function boundedError(error) {
  return String(error?.message || error || "target execution failed").slice(0, 2048);
}

function validateGatewayUrl(value, { allowHttpLoopback = false } = {}) {
  const url = new URL(String(value || "").trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("agent gateway URL must not contain credentials, query parameters, or a fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("agent gateway URL must be an origin only");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new Error("agent gateway URL must use HTTPS");
  }
  return url.origin;
}

export async function loadAgentPrivateKey(file) {
  const filename = String(file || "").trim();
  if (!filename) throw new Error("agent private key file is required");
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("agent private key must be a regular non-symlink file");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("agent private key file must not be group/world accessible");
  }
  const pem = await fs.readFile(filename, "utf8");
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("agent private key must use Ed25519");
  }
  return key;
}

export class TargetAgentHttpClient {
  constructor({
    gatewayUrl,
    targetId,
    privateKey,
    sessionId = newTargetSessionId(),
    allowHttpLoopback = false,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    if (!privateKey || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("Ed25519 private key is required");
    }
    this.gateway = validateGatewayUrl(gatewayUrl, { allowHttpLoopback });
    this.targetId = normalizeTargetId(targetId);
    if (this.targetId === "local") throw new Error("outbound agent requires an explicit opaque zt_ target id");
    this.privateKey = privateKey;
    this.sessionId = sessionId;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async #post(pathname, value, { timeoutMs = 35000 } = {}) {
    const body = JSON.stringify(value);
    const timestamp = Math.floor(this.now() / 1000);
    const nonce = "nonce_" + crypto.randomBytes(18).toString("base64url");
    const canonical = canonicalAgentRequest({
      method: "POST",
      requestPath: pathname,
      targetId: this.targetId,
      timestamp,
      nonce,
      body,
    });
    const signature = crypto
      .sign(null, Buffer.from(canonical, "utf8"), this.privateKey)
      .toString("base64url");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.gateway + pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-zssh-target-id": this.targetId,
          "x-zssh-agent-timestamp": String(timestamp),
          "x-zssh-agent-nonce": nonce,
          "x-zssh-agent-signature": signature,
        },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("agent gateway returned non-JSON response");
      }
      if (!response.ok) {
        throw new Error("agent gateway request failed with HTTP " + response.status + ": " + String(parsed?.error || "error"));
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect() {
    return this.#post("/agent/v1/connect", { session_id: this.sessionId }, { timeoutMs: 10000 });
  }

  async poll(waitMs = 25000) {
    return this.#post(
      "/agent/v1/poll",
      { session_id: this.sessionId, wait_ms: waitMs },
      { timeoutMs: Math.min(40000, Math.max(10000, Number(waitMs) + 10000)) },
    );
  }

  async complete(requestId, result) {
    return this.#post("/agent/v1/result", {
      session_id: this.sessionId,
      request_id: requestId,
      result,
    }, { timeoutMs: 10000 });
  }

  async fail(requestId, error) {
    return this.#post("/agent/v1/result", {
      session_id: this.sessionId,
      request_id: requestId,
      error: boundedError(error),
    }, { timeoutMs: 10000 });
  }

  async disconnect() {
    return this.#post("/agent/v1/disconnect", { session_id: this.sessionId }, { timeoutMs: 10000 });
  }
}

export async function runTargetAgentSession({
  client,
  executeTool,
  signal,
  pollWaitMs = 25000,
  onEvent = () => {},
} = {}) {
  if (!(client instanceof TargetAgentHttpClient)) throw new Error("target agent HTTP client is required");
  if (typeof executeTool !== "function") throw new Error("target tool executor is required");
  if (typeof onEvent !== "function") throw new Error("onEvent must be a function");

  await client.connect();
  onEvent({ type: "connected", target_id: client.targetId, session_id: client.sessionId });

  try {
    while (!signal?.aborted) {
      const command = await client.poll(pollWaitMs);
      if (command?.type === "idle") continue;
      if (command?.type === "disconnected") break;
      if (command?.type !== "tool_call" || !ALLOWED_TOOLS.has(String(command.tool || ""))) {
        throw new Error("gateway delivered a non-allowlisted target command");
      }

      try {
        const result = await executeTool(command.tool, command.args || {});
        await client.complete(command.request_id, result);
        onEvent({ type: "completed", request_id: command.request_id, tool: command.tool });
      } catch (error) {
        await client.fail(command.request_id, error);
        onEvent({ type: "failed", request_id: command.request_id, tool: command.tool });
      }
    }
  } finally {
    try {
      await client.disconnect();
    } catch {
      // Connection may already be gone; target process should still stop.
    }
  }
}

export async function runTargetAgentForever({
  createClient,
  executeTool,
  signal,
  reconnectDelayMs = 2000,
  maxReconnectDelayMs = 30000,
  onEvent = () => {},
} = {}) {
  if (typeof createClient !== "function") throw new Error("createClient is required");
  let delay = reconnectDelayMs;

  while (!signal?.aborted) {
    try {
      const client = await createClient();
      await runTargetAgentSession({ client, executeTool, signal, onEvent });
      delay = reconnectDelayMs;
    } catch (error) {
      onEvent({ type: "connection_error", error: boundedError(error) });
      if (signal?.aborted) break;
      await sleep(delay);
      delay = Math.min(maxReconnectDelayMs, Math.max(reconnectDelayMs, delay * 2));
    }
  }
}
