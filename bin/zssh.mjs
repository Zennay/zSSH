#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createClientToken,
  listClientTokens,
  revokeClientToken
} from "../auth-store.mjs";

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
  zssh connect [label]

"connect" creates a new revocable client token and prints the MCP connection
details. Configure ZSSH_PUBLIC_URL in gateway.env to receive a ready-to-paste
HTTPS capability URL.
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

const [command, subcommand, value] = process.argv.slice(2);

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
      for (const client of clients) {
        console.log(`${client.id}\t${client.label}\t${client.created_at}`);
      }
    }
  } else if (command === "token" && subcommand === "revoke") {
    if (!value) throw new Error("token id is required");
    const revoked = await revokeClientToken(value);
    console.log(revoked ? "ZSSH_CLIENT_TOKEN_REVOKED" : "ZSSH_CLIENT_TOKEN_NOT_FOUND");
    process.exitCode = revoked ? 0 : 3;
  } else if (command === "connect") {
    const created = await createClientToken(subcommand || "chatgpt");
    const url = capabilityUrl(created.token);
    console.log("ZSSH_CONNECTION_CREATED");
    console.log("target=" + (process.env.ZSSH_TARGET_NAME || os.hostname()));
    console.log("client_id=" + created.id);
    if (url) {
      console.log("mcp_url=" + url);
      console.log("Paste the mcp_url into ChatGPT. Treat the full URL as a secret.");
    } else {
      console.log("token=" + created.token);
      console.log("Set ZSSH_PUBLIC_URL=https://your-hostname in " + ENV_FILE + " to print a ready-to-paste MCP URL.");
    }
  } else {
    usage();
    process.exitCode = command ? 2 : 0;
  }
} catch (err) {
  console.error("zSSH:", err?.message || String(err));
  process.exitCode = 2;
}
