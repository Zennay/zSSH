#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClientToken, listClientTokens, revokeClientToken } from "../auth-store.mjs";
import { createAgentToken, listAgentTokens, revokeAgentToken } from "../agent-auth-store.mjs";

const ENV_FILE = process.env.ZSSH_ENV_FILE || path.join(os.homedir(), ".config", "zssh", "gateway.env");

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index);
    if (!key.startsWith("ZSSH_") && key !== "PORT") continue;
    if (process.env[key] === undefined) process.env[key] = line.slice(index + 1);
  }
}

function usage() {
  console.log(`zSSH CLI

Usage:
  zssh token create [label]
  zssh token list
  zssh token revoke <id>
  zssh agent-token create <zt_target_id> [label]
  zssh agent-token list
  zssh agent-token revoke <id>
  zssh connect [label]

Local client tokens are private/self-hosted credentials. Agent tokens are
separate target-to-gateway credentials bound to one opaque zt_ target ID.
Neither is used as the public OpenAI user OAuth credential. Tokens are printed
once; only hashes are stored. "connect" prints a private client token once, or
a private HTTPS capability URL when ZSSH_PUBLIC_URL is configured.
`);
}

function capabilityUrl(token) {
  const raw = String(process.env.ZSSH_PUBLIC_URL || "").trim();
  if (!raw) return null;
  const base = new URL(raw);
  if (base.protocol !== "https:") throw new Error("ZSSH_PUBLIC_URL must use https://");
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("ZSSH_PUBLIC_URL must not include credentials, query parameters, or a fragment");
  }
  if (base.pathname !== "/" && base.pathname !== "") {
    throw new Error("ZSSH_PUBLIC_URL must be an origin only; do not include /mcp");
  }
  return base.origin + "/mcp/" + token;
}

loadEnvFile();

const [command, subcommand, value, extra] = process.argv.slice(2);

try {
  if (command === "token" && subcommand === "create") {
    const created = await createClientToken(value || "chatgpt");
    console.log("ZSSH_CLIENT_TOKEN_CREATED");
    console.log("id=" + created.id);
    console.log("label=" + created.label);
    console.log("token=" + created.token);
  } else if (command === "token" && subcommand === "list") {
    const clients = await listClientTokens();
    if (!clients.length) {
      console.log("No revocable zSSH client tokens.");
    } else {
      for (const client of clients) console.log(`${client.id}\t${client.label}\t${client.created_at}`);
    }
  } else if (command === "token" && subcommand === "revoke") {
    if (!value) throw new Error("token id is required");
    const revoked = await revokeClientToken(value);
    console.log(revoked ? "ZSSH_CLIENT_TOKEN_REVOKED" : "ZSSH_CLIENT_TOKEN_NOT_FOUND");
    process.exitCode = revoked ? 0 : 3;
  } else if (command === "agent-token" && subcommand === "create") {
    if (!value) throw new Error("target id is required");
    const created = await createAgentToken(value, extra || "target-agent");
    console.log("ZSSH_AGENT_TOKEN_CREATED");
    console.log("id=" + created.id);
    console.log("target_id=" + created.target_id);
    console.log("label=" + created.label);
    console.log("token=" + created.token);
    console.log("Store this token only on the target agent; it will not be shown again.");
  } else if (command === "agent-token" && subcommand === "list") {
    const agents = await listAgentTokens();
    if (!agents.length) {
      console.log("No revocable zSSH agent tokens.");
    } else {
      for (const agent of agents) console.log(`${agent.id}\t${agent.target_id}\t${agent.label}\t${agent.created_at}`);
    }
  } else if (command === "agent-token" && subcommand === "revoke") {
    if (!value) throw new Error("agent token id is required");
    const revoked = await revokeAgentToken(value);
    console.log(revoked ? "ZSSH_AGENT_TOKEN_REVOKED" : "ZSSH_AGENT_TOKEN_NOT_FOUND");
    process.exitCode = revoked ? 0 : 3;
  } else if (command === "connect") {
    const created = await createClientToken(subcommand || "chatgpt");
    const url = capabilityUrl(created.token);
    console.log("ZSSH_CONNECTION_CREATED");
    console.log("client_id=" + created.id);
    if (url) {
      console.log("mcp_url=" + url);
      console.log("Treat the full mcp_url as a secret.");
    } else {
      console.log("token=" + created.token);
      console.log("Set ZSSH_PUBLIC_URL=https://your-hostname in " + ENV_FILE + " to print a private capability URL.");
    }
  } else {
    usage();
    process.exitCode = command ? 2 : 0;
  }
} catch (err) {
  console.error("zSSH:", err?.message || String(err));
  process.exitCode = 2;
}
