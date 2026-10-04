#!/usr/bin/env node
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { signAgentRequest } from "./agent-transport.mjs";
import { executeAgentCommand } from "./agent-runtime.mjs";
import { normalizeTargetId } from "./pairing.mjs";

function required(name, env = process.env) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function gatewayBase(env = process.env) {
  const raw = required("ZSSH_GATEWAY_URL", env);
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("ZSSH_GATEWAY_URL must not contain credentials, query parameters, or fragments");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("ZSSH_GATEWAY_URL must be an origin URL without a path");
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && env.NODE_ENV !== "production")) {
    throw new Error("ZSSH_GATEWAY_URL must use HTTPS outside local development");
  }
  return url.origin;
}

async function loadPrivateKey(env = process.env) {
  const file = required("ZSSH_AGENT_PRIVATE_KEY_FILE", env);
  const key = crypto.createPrivateKey(await readFile(file, "utf8"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("agent private key must be Ed25519");
  return key;
}

export async function createAgentClient({ env = process.env, fetchImpl = fetch } = {}) {
  const base = gatewayBase(env);
  const targetId = normalizeTargetId(required("ZSSH_TARGET_ID", env));
  const privateKey = await loadPrivateKey(env);

  async function post(pathname, value) {
    const body = JSON.stringify(value ?? {});
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce_" + crypto.randomBytes(18).toString("base64url");
    const signature = signAgentRequest(privateKey, {
      method: "POST",
      pathname,
      targetId,
      timestamp,
      nonce,
      body,
    });

    const response = await fetchImpl(base + pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zssh-agent-target": targetId,
        "x-zssh-agent-timestamp": timestamp,
        "x-zssh-agent-nonce": nonce,
        "x-zssh-agent-signature": signature,
      },
      body,
    });
    const text = await response.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      throw new Error("gateway agent endpoint failed with HTTP " + response.status + (parsed?.error ? ": " + parsed.error : ""));
    }
    return parsed;
  }

  return {
    target_id: targetId,
    async open() {
      return await post("/agent/v1/session", {});
    },
    async poll(sessionId) {
      return await post("/agent/v1/poll", { session_id: sessionId });
    },
    async result(sessionId, requestId, result) {
      return await post("/agent/v1/result", {
        session_id: sessionId,
        request_id: requestId,
        result,
      });
    },
    async disconnect(sessionId) {
      return await post("/agent/v1/disconnect", { session_id: sessionId });
    },
    async pairings() {
      return await post("/agent/v1/pairings", {});
    },
    async approvePairing(requestId) {
      return await post("/agent/v1/pairing/approve", { request_id: requestId });
    },
    async revokePairing(profileId) {
      return await post("/agent/v1/pairing/revoke", { profile_id: profileId });
    },
  };
}

export async function runAgent({ env = process.env, fetchImpl = fetch, signal } = {}) {
  const client = await createAgentClient({ env, fetchImpl });
  const opened = await client.open();
  const sessionId = String(opened.session_id || "");
  if (!/^sess_[A-Za-z0-9_-]{12,96}$/.test(sessionId)) throw new Error("gateway returned an invalid agent session id");

  const stop = () => Boolean(signal?.aborted);
  try {
    while (!stop()) {
      const polled = await client.poll(sessionId);
      const command = polled.command;
      if (!command) continue;

      let value;
      try {
        value = await executeAgentCommand(command);
      } catch (err) {
        value = { ok: false, error: String(err?.message || err) };
      }
      await client.result(sessionId, command.request_id, value);
    }
  } finally {
    try { await client.disconnect(sessionId); } catch {}
  }
}

export async function runAgentCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const [command, value] = argv;
  if (!command || command === "run") {
    const controller = new AbortController();
    for (const event of ["SIGINT", "SIGTERM"]) {
      process.once(event, () => controller.abort());
    }
    await runAgent({ env, fetchImpl, signal: controller.signal });
    return null;
  }

  const client = await createAgentClient({ env, fetchImpl });
  if (command === "pairings") {
    return await client.pairings();
  }
  if (command === "approve") {
    if (!/^pair_[a-f0-9]{24}$/.test(String(value || ""))) {
      throw new Error("usage: node agent.mjs approve <pairing-request-id>");
    }
    return await client.approvePairing(value);
  }
  if (command === "revoke") {
    if (!/^zssh_[a-f0-9]{32}$/.test(String(value || ""))) {
      throw new Error("usage: node agent.mjs revoke <profile-id>");
    }
    return await client.revokePairing(value);
  }

  throw new Error("usage: node agent.mjs [run|pairings|approve <request-id>|revoke <profile-id>]");
}

async function main() {
  const result = await runAgentCli();
  if (result !== null) console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error("zSSH agent failed:", String(err?.message || err));
    process.exitCode = 1;
  });
}
