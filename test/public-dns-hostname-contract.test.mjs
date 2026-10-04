import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAuthorizationServerMetadata,
  validatePublicMcpUrl,
} from "../release-contract.mjs";

test("public release URLs require DNS hostnames instead of IP literals", () => {
  assert.throws(
    () => validatePublicMcpUrl("https://8.8.8.8/mcp"),
    /public hostname/,
  );
  assert.throws(
    () => validatePublicMcpUrl("https://[2606:4700:4700::1111]/mcp"),
    /public hostname/,
  );
});

test("OAuth metadata also rejects public IP literals", () => {
  const metadata = {
    issuer: "https://8.8.8.8/tenant",
    authorization_endpoint: "https://8.8.8.8/tenant/authorize",
    token_endpoint: "https://8.8.8.8/tenant/token",
    registration_endpoint: "https://8.8.8.8/tenant/register",
    client_id_metadata_document_supported: true,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };

  assert.throws(
    () => validateAuthorizationServerMetadata(metadata, metadata.issuer),
    /public hostname/,
  );
});
