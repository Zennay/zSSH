import net from "node:net";
import { pathToFileURL } from "node:url";
import { isPublicRoutableAddress } from "./check-public-ingress.mjs";
import { validatePublicBaseUrl } from "./render-public-caddy.mjs";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";

function fail(message) {
  throw new Error(message);
}

export function validateCloudflareZoneId(value) {
  const zoneId = String(value || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(zoneId)) fail("CLOUDFLARE_ZONE_ID must be a 32-character hexadecimal zone ID");
  return zoneId;
}

export function validatePublicIpv4(value) {
  const ipv4 = String(value || "").trim();
  if (net.isIP(ipv4) !== 4 || !isPublicRoutableAddress(ipv4)) {
    fail("ZSSH_PUBLIC_IPV4 must be a publicly routable IPv4 address");
  }
  return ipv4;
}

function normalizeDnsName(value) {
  return String(value || "").trim().replace(/\.$/, "").toLowerCase();
}

function cloudflareErrorSummary(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return errors.slice(0, 3).map(error => {
    const code = Number.isFinite(Number(error?.code)) ? String(error.code) : "unknown";
    const message = String(error?.message || "Cloudflare API error").replace(/[\r\n]+/g, " ").slice(0, 180);
    return `${code}: ${message}`;
  }).join("; ");
}

async function cloudflareJson(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, init);
  let body;
  try {
    body = await response.json();
  } catch {
    fail(`${label} failed: Cloudflare returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok || body?.success !== true) {
    const summary = cloudflareErrorSummary(body);
    fail(`${label} failed: HTTP ${response.status}${summary ? ` (${summary})` : ""}`);
  }
  return body;
}

export async function reconcileCloudflareDns({
  zoneId,
  apiToken,
  publicBaseUrl,
  ipv4,
  apply = false,
  fetchImpl = fetch,
} = {}) {
  const checkedZoneId = validateCloudflareZoneId(zoneId);
  const token = String(apiToken || "").trim();
  if (!token) fail("CLOUDFLARE_API_TOKEN is required");
  const origin = validatePublicBaseUrl(publicBaseUrl);
  const hostname = normalizeDnsName(origin.hostname);
  const checkedIpv4 = validatePublicIpv4(ipv4);

  const collectionUrl = new URL(`/client/v4/zones/${checkedZoneId}/dns_records`, CLOUDFLARE_API_ORIGIN);
  collectionUrl.searchParams.set("name", hostname);
  collectionUrl.searchParams.set("per_page", "100");
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const listed = await cloudflareJson(fetchImpl, collectionUrl, { method: "GET", headers }, "DNS record lookup");
  const records = Array.isArray(listed.result) ? listed.result : [];
  const exact = records.filter(record => normalizeDnsName(record?.name) === hostname);
  const blockers = exact.filter(record => record?.type === "CNAME" || record?.type === "NS");
  if (blockers.length > 0) {
    fail(`DNS name ${hostname} has a conflicting ${blockers[0].type} record; refusing mutation`);
  }

  const aRecords = exact.filter(record => record?.type === "A");
  if (aRecords.length > 1) {
    fail(`DNS name ${hostname} has multiple A records; refusing to collapse an existing RRset`);
  }

  const existing = aRecords[0] || null;
  const desired = { type: "A", name: hostname, content: checkedIpv4, ttl: 1, proxied: false };
  if (existing && String(existing.content) === checkedIpv4 && existing.proxied === false) {
    return { ok: true, action: "noop", hostname, ipv4: checkedIpv4, proxied: false };
  }

  const action = existing ? "update" : "create";
  if (!apply) {
    return { ok: true, action: `would_${action}`, hostname, ipv4: checkedIpv4, proxied: false };
  }

  const targetUrl = existing
    ? new URL(`/client/v4/zones/${checkedZoneId}/dns_records/${encodeURIComponent(String(existing.id || ""))}`, CLOUDFLARE_API_ORIGIN)
    : collectionUrl;
  if (existing && !/^[a-f0-9]{32}$/i.test(String(existing.id || ""))) {
    fail("existing Cloudflare A record has an invalid record ID");
  }

  const body = await cloudflareJson(fetchImpl, targetUrl, {
    method: existing ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(desired),
  }, `DNS record ${action}`);
  const record = body.result || {};
  if (
    record.type !== "A" ||
    normalizeDnsName(record.name) !== hostname ||
    String(record.content) !== checkedIpv4 ||
    record.proxied !== false
  ) {
    fail("Cloudflare returned a DNS record that does not match the requested DNS-only A record");
  }

  return {
    ok: true,
    action: action === "create" ? "created" : "updated",
    hostname,
    ipv4: checkedIpv4,
    proxied: false,
  };
}

export async function main({ env = process.env, stdout = process.stdout } = {}) {
  const result = await reconcileCloudflareDns({
    zoneId: env.CLOUDFLARE_ZONE_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    publicBaseUrl: env.ZSSH_PUBLIC_BASE_URL,
    ipv4: env.ZSSH_PUBLIC_IPV4,
    apply: env.ZSSH_DNS_APPLY === "1",
  });
  stdout.write(JSON.stringify(result, null, 2) + "\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
