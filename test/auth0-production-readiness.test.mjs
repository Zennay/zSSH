import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAuth0DefaultUserGrant,
  validateAuth0ResourceServers,
  validateAuth0TenantSettings,
} from "../scripts/check-auth0-production.mjs";

const resource = "https://zssh.cheapgpt.shop";

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
