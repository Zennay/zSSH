#!/usr/bin/env node
// Observe externally managed DNS without Cloudflare credentials or DNS mutations.
// Used by the protected production-readiness job; never trust a manually set
// "verified" flag without this live resolver step.
import { resolve4, resolve6, resolveCname, resolveNs } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { validatePublicIpv4 } from "./publish-cloudflare-dns.mjs";
import { validatePublicMcpUrl } from "../release-contract.mjs";

function normalized(name) {
  return String(name || "").trim().toLowerCase().replace(/\.$/, "");
}

async function optionalRecords(resolve, hostname) {
  try {
    return await resolve(hostname);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ENODOMAIN"].includes(error?.code)) return [];
    throw error;
  }
}

export async function observeExternalDns(env = process.env, dns = {
  resolve4, resolve6, resolveCname, resolveNs,
}) {
  const refuse = reason_code => ({
    schema_version: 1,
    verified: false,
    provider: "external",
    reason_code,
  });
  if (String(env.ZSSH_DNS_PROVIDER || "").trim() !== "external") {
    return refuse("external_provider_not_selected");
  }

  const zone = normalized(env.ZSSH_DNS_ZONE_NAME);
  const hostname = normalized(env.ZSSH_DNS_APPROVED_HOSTNAME);
  const origin = String(env.ZSSH_DNS_PUBLIC_BASE_URL || "").trim();
  const configuredMcp = String(env.ZSSH_PLUGIN_MCP_URL || "").trim();
  const expectedNameservers = String(env.ZSSH_DNS_EXPECTED_NAMESERVERS || "")
    .split(",").map(normalized).filter(Boolean).sort();

  if (!zone || !hostname || !origin || !configuredMcp || !expectedNameservers.length ||
      new Set(expectedNameservers).size !== expectedNameservers.length ||
      expectedNameservers.some(ns => !/^[a-z0-9.-]+$/.test(ns))) {
    return refuse("protected_configuration_missing_or_invalid");
  }
  if (hostname !== "zssh." + zone || zone === "cheapgpt.shop" ||
      hostname === zone || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) {
    return refuse("hostname_zone_mismatch");
  }

  let ipv4;
  try {
    ipv4 = validatePublicIpv4(env.ZSSH_DNS_TARGET_IPV4);
    const mcp = validatePublicMcpUrl(configuredMcp);
    if (mcp.href !== origin + "/mcp" || new URL(origin).hostname !== hostname ||
        new URL(origin).href !== "https://" + hostname + "/") {
      return refuse("approved_origin_mismatch");
    }
  } catch {
    return refuse("protected_configuration_invalid");
  }

  try {
    const [nameservers, addresses, ipv6, aliases] = await Promise.all([
      dns.resolveNs(zone),
      dns.resolve4(hostname),
      optionalRecords(dns.resolve6, hostname),
      optionalRecords(dns.resolveCname, hostname),
    ]);
    const observedNs = nameservers.map(normalized).sort();
    if (observedNs.length !== expectedNameservers.length ||
        observedNs.some((ns, i) => ns !== expectedNameservers[i])) {
      return refuse("nameservers_changed");
    }
    if (addresses.length !== 1 || addresses[0] !== ipv4 ||
        ipv6.length !== 0 || aliases.length !== 0) {
      return refuse("dns_address_or_record_mismatch");
    }
    return {
      schema_version: 1,
      verified: true,
      provider: "external",
      reason_code: "dns_exact_match",
      hostname,
      expected_ipv4: ipv4,
      nameservers: observedNs,
    };
  } catch {
    return refuse("dns_lookup_failed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  observeExternalDns().then(result => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch(() => {
    process.stdout.write(JSON.stringify({
      schema_version: 1, verified: false, provider: "external",
      reason_code: "observation_failed",
    }) + "\n");
  });
}
