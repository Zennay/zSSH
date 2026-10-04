#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { fetchAuthorizationServerMetadata, isNonPublicHostname } from "../release-contract.mjs";

const REQUIRED_SCOPES = Object.freeze(["zssh:read", "zssh:write"]);

function fail(message) {
  throw new Error(message);
}

function asArray(payload, field) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[field])) return payload[field];
  return [];
}

function requirePublicHttpsUrl(raw, name) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    fail(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail(`${name} must be an HTTPS URL without embedded credentials`);
  }
  if (!url.hostname.includes(".") || isNonPublicHostname(url.hostname)) {
    fail(`${name} must use a public hostname`);
  }
  return url;
}

function isCanonicalAuth0TenantHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return normalized !== "auth0.com" && normalized.endsWith(".auth0.com");
}

export function resolveAuth0ManagementBaseUrl(issuer, managementBaseUrl) {
  const issuerUrl = requirePublicHttpsUrl(issuer, "ZSSH_OAUTH_ISSUER");
  const explicit = String(managementBaseUrl || "").trim();

  if (!explicit) {
    if (!isCanonicalAuth0TenantHostname(issuerUrl.hostname)) {
      fail("AUTH0_MANAGEMENT_BASE_URL is required when ZSSH_OAUTH_ISSUER uses a custom Auth0 domain");
    }
    return new URL(issuerUrl.origin);
  }

  const managementBase = requirePublicHttpsUrl(explicit, "AUTH0_MANAGEMENT_BASE_URL");
  if (!isCanonicalAuth0TenantHostname(managementBase.hostname)) {
    fail("AUTH0_MANAGEMENT_BASE_URL must use a canonical *.auth0.com tenant domain");
  }
  if (
    isCanonicalAuth0TenantHostname(issuerUrl.hostname) &&
    managementBase.origin !== issuerUrl.origin
  ) {
    fail("AUTH0_MANAGEMENT_BASE_URL must match the canonical Auth0 issuer origin");
  }
  return managementBase;
}

export function validateAuth0TenantSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    fail("Auth0 tenant settings must be an object");
  }
  if (settings.flags?.enable_dynamic_client_registration !== true) {
    fail("Auth0 tenant must enable Dynamic Client Registration");
  }
  if (settings.dynamic_client_registration_security_mode !== "strict") {
    fail("Auth0 tenant must use strict Dynamic Client Registration security mode");
  }
  if (settings.resource_parameter_profile !== "compatibility") {
    fail("Auth0 tenant must enable the Resource Parameter Compatibility Profile");
  }
  if (settings.authorization_response_iss_parameter_supported !== true) {
    fail("Auth0 tenant must enable RFC 9207 authorization response issuer identification");
  }
  return {
    dcr_enabled: true,
    dcr_security_mode: "strict",
    resource_parameter_profile: "compatibility",
    authorization_response_iss_parameter_supported: true,
    cimd_enabled: settings.client_id_metadata_document_supported === true,
  };
}

export function validateAuth0ResourceServers(payload, expectedResource) {
  const resources = asArray(payload, "resource_servers");
  const resource = resources.find(item => item?.identifier === expectedResource);
  if (!resource) fail("Auth0 resource server for the exact zSSH public resource is missing");
  if (resource.signing_alg !== "RS256") {
    fail("Auth0 zSSH resource server must use RS256 access-token signing");
  }
  const scopes = new Set(asArray(resource.scopes, "scopes").map(item => String(item?.value || "")));
  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.has(scope)) fail(`Auth0 zSSH resource server is missing scope: ${scope}`);
  }
  return {
    resource_server_id: String(resource.id || ""),
    resource: expectedResource,
    signing_alg: "RS256",
    required_scopes: [...REQUIRED_SCOPES],
  };
}

export function validateAuth0DefaultUserGrant(payload, expectedResource) {
  const grants = asArray(payload, "client_grants");
  const candidates = grants.filter(grant =>
    grant?.audience === expectedResource &&
    grant?.default_for === "third_party_clients" &&
    grant?.subject_type === "user"
  );
  if (candidates.length !== 1) {
    fail("Auth0 must have exactly one default user-delegated third-party grant for the zSSH resource");
  }
  const grant = candidates[0];
  if (grant.allow_all_scopes === true) {
    fail("Auth0 default third-party user grant must not allow all present/future scopes");
  }
  const scopes = [...new Set((grant.scope || []).map(String))].sort();
  const expected = [...REQUIRED_SCOPES].sort();
  if (JSON.stringify(scopes) !== JSON.stringify(expected)) {
    fail("Auth0 default third-party user grant must grant exactly zssh:read and zssh:write");
  }
  return {
    grant_id: String(grant.id || ""),
    default_for: "third_party_clients",
    subject_type: "user",
    scopes: expected,
    allow_all_scopes: false,
  };
}

async function fetchJson(url, token, label, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    redirect: "manual",
    headers: {
      accept: "application/json",
      authorization: "Bearer " + token,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status >= 300 && response.status < 400) {
    fail(`${label} must not redirect`);
  }
  if (!response.ok) fail(`${label} failed: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    fail(`${label} did not return valid JSON`);
  }
}

export async function checkAuth0ProductionReadiness({
  issuer,
  managementBaseUrl,
  managementToken,
  resource,
  fetchImpl = fetch,
}) {
  const issuerUrl = requirePublicHttpsUrl(issuer, "ZSSH_OAUTH_ISSUER");
  const managementBase = resolveAuth0ManagementBaseUrl(issuer, managementBaseUrl);
  const resourceUrl = requirePublicHttpsUrl(resource, "zSSH OAuth resource");
  const token = String(managementToken || "").trim();
  if (token.length < 20) fail("AUTH0_MANAGEMENT_API_TOKEN is required");

  const discovered = await fetchAuthorizationServerMetadata(issuerUrl.href, {
    fetchImpl,
  });
  if (!discovered.validated.client_registration_methods.includes("dcr")) {
    fail("Auth0 production issuer must expose DCR in public authorization-server metadata");
  }
  if (discovered.validated.authorization_response_iss_parameter_supported !== true) {
    fail("Auth0 production issuer metadata must advertise RFC 9207 issuer identification");
  }
  const registration = new URL(discovered.validated.registration_endpoint);
  if (registration.origin !== issuerUrl.origin) {
    fail("Auth0 DCR registration endpoint must remain on the authorization-server origin");
  }

  const jwksUri = requirePublicHttpsUrl(discovered.metadata.jwks_uri, "Auth0 jwks_uri");
  const apiBase = new URL("/api/v2/", managementBase.origin);
  const settings = await fetchJson(new URL("tenants/settings", apiBase), token, "Auth0 tenant settings", fetchImpl);
  const tenant = validateAuth0TenantSettings(settings);

  const resourcesUrl = new URL("resource-servers", apiBase);
  resourcesUrl.searchParams.set("per_page", "100");
  const resources = validateAuth0ResourceServers(
    await fetchJson(resourcesUrl, token, "Auth0 resource servers", fetchImpl),
    resourceUrl.origin,
  );

  const grantsUrl = new URL("client-grants", apiBase);
  grantsUrl.searchParams.set("audience", resourceUrl.origin);
  grantsUrl.searchParams.set("subject_type", "user");
  grantsUrl.searchParams.set("default_for", "third_party_clients");
  grantsUrl.searchParams.set("per_page", "100");
  const grant = validateAuth0DefaultUserGrant(
    await fetchJson(grantsUrl, token, "Auth0 third-party client grants", fetchImpl),
    resourceUrl.origin,
  );

  return {
    ok: true,
    provider: "auth0",
    issuer: discovered.validated.issuer,
    auth0_management_origin: managementBase.origin,
    auth0_management_origin_derived: String(managementBaseUrl || "").trim().length === 0,
    authorization_server_metadata_url: discovered.url,
    registration_endpoint: discovered.validated.registration_endpoint,
    jwks_uri: jwksUri.href,
    pkce_s256: discovered.validated.pkce_s256 === true,
    authorization_code: discovered.validated.authorization_code === true,
    client_registration_methods: discovered.validated.client_registration_methods,
    tenant,
    resource_server: resources,
    default_user_grant: grant,
  };
}

async function main() {
  const mcpUrl = requirePublicHttpsUrl(process.env.ZSSH_PLUGIN_MCP_URL, "ZSSH_PLUGIN_MCP_URL");
  const result = await checkAuth0ProductionReadiness({
    issuer: process.env.ZSSH_OAUTH_ISSUER,
    managementBaseUrl: process.env.AUTH0_MANAGEMENT_BASE_URL,
    managementToken: process.env.AUTH0_MANAGEMENT_API_TOKEN,
    resource: mcpUrl.origin,
  });
  console.log(JSON.stringify(result, null, 2));
  console.error("AUTH0_PRODUCTION_READINESS_GREEN");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
