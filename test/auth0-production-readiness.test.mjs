import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkAuth0ProductionReadiness,
  resolveAuth0ManagementBaseUrl,
  validateAuth0DefaultUserGrant,
  validateAuth0ResourceServers,
  validateAuth0TenantSettings,
} from "../scripts/check-auth0-production.mjs";

const resource = "https://zssh.cheapgpt.shop";

const auth0Workflow = readFileSync(
  new URL("../.github/workflows/auth0-production-preflight.yml", import.meta.url),
  "utf8",
);

test("Auth0 management token is scoped only to the provider validation step", () => {
  const stepsIndex = auth0Workflow.indexOf("    steps:\n");
  assert.notEqual(stepsIndex, -1);
  assert.doesNotMatch(auth0Workflow.slice(0, stepsIndex), /AUTH0_MANAGEMENT_API_TOKEN/);

  const marker = "      - name: Validate Auth0 tenant, API and DCR grant\n";
  const start = auth0Workflow.indexOf(marker);
  assert.notEqual(start, -1);
  const next = auth0Workflow.indexOf("\n      - name:", start + marker.length);
  const validationStep = next === -1
    ? auth0Workflow.slice(start)
    : auth0Workflow.slice(start, next);

  assert.match(
    validationStep,
    /AUTH0_MANAGEMENT_API_TOKEN: \$\{\{ secrets\.AUTH0_MANAGEMENT_API_TOKEN \}\}/,
  );
  assert.equal((auth0Workflow.match(/AUTH0_MANAGEMENT_API_TOKEN:/g) || []).length, 1);
});


test("Auth0 management origin derives only from canonical tenant issuers", () => {
  assert.equal(
    resolveAuth0ManagementBaseUrl("https://tenant.eu.auth0.com/", "").origin,
    "https://tenant.eu.auth0.com",
  );
  assert.throws(
    () => resolveAuth0ManagementBaseUrl("https://login.cheapgpt.shop/", ""),
    /required when ZSSH_OAUTH_ISSUER uses a custom Auth0 domain/,
  );
  assert.throws(
    () => resolveAuth0ManagementBaseUrl(
      "https://tenant.eu.auth0.com/",
      "https://other.eu.auth0.com",
    ),
    /must match the canonical Auth0 issuer origin/,
  );
  assert.throws(
    () => resolveAuth0ManagementBaseUrl(
      "https://login.cheapgpt.shop/",
      "https://management.cheapgpt.shop",
    ),
    /canonical \*\.auth0\.com tenant domain/,
  );
});

test("Auth0 tenant settings enforce MCP production compatibility", () => {
  const good = {
    flags: { enable_dynamic_client_registration: true },
    dynamic_client_registration_security_mode: "strict",
    resource_parameter_profile: "compatibility",
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
  assert.deepEqual(validateAuth0TenantSettings(good), {
    dcr_enabled: true,
    dcr_security_mode: "strict",
    resource_parameter_profile: "compatibility",
    authorization_response_iss_parameter_supported: true,
    cimd_enabled: false,
  });
  assert.throws(
    () => validateAuth0TenantSettings({ ...good, resource_parameter_profile: "audience" }),
    /Resource Parameter Compatibility Profile/,
  );
  assert.throws(
    () => validateAuth0TenantSettings({ ...good, dynamic_client_registration_security_mode: "permissive" }),
    /strict Dynamic Client Registration/,
  );
  assert.throws(
    () => validateAuth0TenantSettings({ ...good, authorization_response_iss_parameter_supported: false }),
    /RFC 9207/,
  );
});

test("Auth0 resource server is exact, asymmetric and scope-complete", () => {
  const payload = [{
    id: "api_123",
    identifier: resource,
    signing_alg: "RS256",
    scopes: [
      { value: "zssh:read", description: "Read target state" },
      { value: "zssh:write", description: "Write approved target files" },
    ],
  }];
  assert.equal(validateAuth0ResourceServers(payload, resource).resource_server_id, "api_123");
  assert.throws(
    () => validateAuth0ResourceServers([{ ...payload[0], signing_alg: "HS256" }], resource),
    /RS256/,
  );
  assert.throws(
    () => validateAuth0ResourceServers([{ ...payload[0], scopes: [{ value: "zssh:read" }] }], resource),
    /zssh:write/,
  );
});

test("Auth0 DCR default grant stays user-delegated and least privilege", () => {
  const good = [{
    id: "grant_123",
    audience: resource,
    default_for: "third_party_clients",
    subject_type: "user",
    scope: ["zssh:write", "zssh:read"],
    allow_all_scopes: false,
  }];
  assert.deepEqual(validateAuth0DefaultUserGrant(good, resource).scopes, ["zssh:read", "zssh:write"]);
  assert.throws(
    () => validateAuth0DefaultUserGrant([{ ...good[0], allow_all_scopes: true }], resource),
    /must not allow all/,
  );
  assert.throws(
    () => validateAuth0DefaultUserGrant([{ ...good[0], scope: ["zssh:read", "zssh:write", "admin"] }], resource),
    /exactly zssh:read and zssh:write/,
  );
  assert.throws(
    () => validateAuth0DefaultUserGrant([{ ...good[0], subject_type: "client" }], resource),
    /exactly one default user-delegated/,
  );
});

test("Auth0 end-to-end preflight binds discovery to tenant settings and least-privilege API grant", async () => {
  const calls = [];
  const metadata = {
    issuer: "https://tenant.eu.auth0.com/",
    authorization_endpoint: "https://tenant.eu.auth0.com/authorize",
    token_endpoint: "https://tenant.eu.auth0.com/oauth/token",
    registration_endpoint: "https://tenant.eu.auth0.com/oidc/register",
    jwks_uri: "https://tenant.eu.auth0.com/.well-known/jwks.json",
    authorization_response_iss_parameter_supported: true,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
  const settings = {
    flags: { enable_dynamic_client_registration: true },
    dynamic_client_registration_security_mode: "strict",
    resource_parameter_profile: "compatibility",
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
  const resources = [{
    id: "api_123",
    identifier: resource,
    signing_alg: "RS256",
    scopes: [{ value: "zssh:read" }, { value: "zssh:write" }],
  }];
  const grants = [{
    id: "grant_123",
    audience: resource,
    default_for: "third_party_clients",
    subject_type: "user",
    scope: ["zssh:read", "zssh:write"],
    allow_all_scopes: false,
  }];

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, authorization: init.headers?.authorization || null });
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(JSON.stringify(metadata), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v2/tenants/settings") {
      return new Response(JSON.stringify(settings), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v2/resource-servers") {
      return new Response(JSON.stringify(resources), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/api/v2/client-grants") {
      return new Response(JSON.stringify(grants), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 404 });
  };

  const result = await checkAuth0ProductionReadiness({
    issuer: metadata.issuer,
    managementBaseUrl: "",
    managementToken: "management-token-0123456789abcdef",
    resource,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "auth0");
  assert.equal(result.auth0_management_origin, "https://tenant.eu.auth0.com");
  assert.equal(result.auth0_management_origin_derived, true);
  assert.deepEqual(result.client_registration_methods, ["dcr"]);
  assert.equal(result.tenant.resource_parameter_profile, "compatibility");
  assert.deepEqual(result.default_user_grant.scopes, ["zssh:read", "zssh:write"]);
  assert.equal(calls.filter(call => call.authorization).length, 3);
  assert.ok(calls.filter(call => call.authorization).every(call => call.authorization.startsWith("Bearer management-token-")));
});
