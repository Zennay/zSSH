import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  assertExactBearerResourceMetadata,
  assertPublicToolScopeContract,
  authorizationServerMetadataUrls,
  fetchAuthorizationServerMetadata,
  fetchNoRedirect,
  isNonPublicHostname,
  protectedResourceMetadataUrl,
  publicToolContractFingerprint,
  validateAuthorizationServerMetadata,
  validateProductionServerInfo,
  validatePublicMcpUrl,
} from "../release-contract.mjs";

test("public MCP URL contract rejects non-public and unstable endpoints", () => {
  assert.equal(validatePublicMcpUrl("https://mcp.zssh.dev/mcp").href, "https://mcp.zssh.dev/mcp");
  assert.equal(validatePublicMcpUrl("https://mcp.zssh.dev/mcp/").pathname, "/mcp/");
  assert.throws(() => validatePublicMcpUrl("http://mcp.zssh.dev/mcp"), /https/);
  assert.throws(() => validatePublicMcpUrl("https://127.0.0.1/mcp"), /public hostname/);
  assert.throws(() => validatePublicMcpUrl("https://mcp.zssh.dev/other"), /\/mcp endpoint/);
  assert.throws(() => validatePublicMcpUrl("https://user:pass@mcp.zssh.dev/mcp"), /credentials/);
  assert.throws(() => validatePublicMcpUrl("https://mcp.zssh.dev/mcp?x=1"), /query parameters/);
  assert.throws(() => validatePublicMcpUrl("https://example.com/mcp"), /public hostname/);
  assert.throws(() => validatePublicMcpUrl("https://mcp.example.net/mcp"), /public hostname/);
  assert.throws(() => validatePublicMcpUrl("https://mcp.example.org/mcp"), /public hostname/);
});

test("private-host detection covers loopback, RFC1918, link-local, and reserved suffixes", () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.4", "169.254.1.2", "demo.local", "demo.test", "example.com", "mcp.example.net", "mcp.example.org"]) {
    assert.equal(isNonPublicHostname(host), true, host);
  }
  assert.equal(isNonPublicHostname("mcp.zssh.dev"), false);
});

test("OAuth protected-resource challenge must match the exact submitted origin", () => {
  const expected = protectedResourceMetadataUrl(new URL("https://mcp.zssh.dev/mcp"));
  assert.equal(expected.href, "https://mcp.zssh.dev/.well-known/oauth-protected-resource");
  const actual = assertExactBearerResourceMetadata(
    'Bearer resource_metadata="https://mcp.zssh.dev/.well-known/oauth-protected-resource"',
    expected
  );
  assert.equal(actual.href, expected.href);
  assert.throws(
    () => assertExactBearerResourceMetadata(
      'Bearer resource_metadata="https://other.example.net/.well-known/oauth-protected-resource"',
      expected
    ),
    /mismatch/
  );
  assert.throws(() => assertExactBearerResourceMetadata("Bearer", expected), /missing resource_metadata/);
});

test("OAuth authorization-server discovery supports RFC 8414 and OIDC issuer paths", () => {
  assert.deepEqual(
    authorizationServerMetadataUrls("https://auth.zssh.dev/tenant").map(url => url.href),
    [
      "https://auth.zssh.dev/.well-known/oauth-authorization-server/tenant",
      "https://auth.zssh.dev/tenant/.well-known/openid-configuration",
    ]
  );
});

test("OAuth authorization-server metadata must prove authorization code and PKCE S256", () => {
  const good = {
    issuer: "https://auth.zssh.dev/tenant",
    authorization_endpoint: "https://auth.zssh.dev/tenant/authorize",
    token_endpoint: "https://auth.zssh.dev/tenant/token",
    registration_endpoint: "https://auth.zssh.dev/tenant/register",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  };
  const validated = validateAuthorizationServerMetadata(good, good.issuer);
  assert.equal(validated.pkce_s256, true);
  assert.equal(validated.authorization_code, true);
  assert.equal(validated.registration_endpoint, good.registration_endpoint);

  assert.throws(
    () => validateAuthorizationServerMetadata({ ...good, issuer: "https://other.zssh.dev" }, good.issuer),
    /issuer mismatch/
  );
  assert.throws(
    () => validateAuthorizationServerMetadata({ ...good, code_challenge_methods_supported: ["plain"] }, good.issuer),
    /PKCE S256/
  );
  assert.throws(
    () => validateAuthorizationServerMetadata({ ...good, response_types_supported: ["token"] }, good.issuer),
    /authorization-code/
  );
  assert.throws(
    () => validateAuthorizationServerMetadata({ ...good, token_endpoint_auth_methods_supported: [] }, good.issuer),
    /token_endpoint_auth_methods_supported/
  );
});

test("OAuth authorization-server discovery falls back from RFC 8414 to OIDC metadata", async () => {
  const calls = [];
  const metadata = {
    issuer: "http://127.0.0.1:8080/tenant",
    authorization_endpoint: "http://127.0.0.1:8080/tenant/authorize",
    token_endpoint: "http://127.0.0.1:8080/tenant/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
  const fetchImpl = async input => {
    calls.push(String(input));
    if (calls.length === 1) return new Response("", { status: 404 });
    return new Response(JSON.stringify(metadata), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const discovered = await fetchAuthorizationServerMetadata(metadata.issuer, {
    allowHttp: true,
    requirePublicHostname: false,
    fetchImpl,
  });
  assert.equal(calls.length, 2);
  assert.match(discovered.url, /openid-configuration$/);
  assert.equal(discovered.validated.pkce_s256, true);
});

test("release probe helper fails closed instead of following redirects", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/ok" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(() => fetchNoRedirect(base + "/redirect", {}, "test endpoint"), /must not redirect/);
    const ok = await fetchNoRedirect(base + "/ok", {}, "test endpoint");
    assert.equal(ok.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("public tool scope contract rejects scope drift and unreviewed surface expansion", () => {
  const read = name => ({
    name,
    securitySchemes: [{ type: "oauth2", scopes: ["zssh:read"] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["zssh:read"] }] },
  });
  const write = {
    name: "zssh_write_file",
    securitySchemes: [{ type: "oauth2", scopes: ["zssh:write"] }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["zssh:write"] }] },
  };
  const tools = [
    read("get_profile"),
    read("get_pairing_status"),
    read("zssh_server_info"),
    read("get_system_uptime"),
    read("get_system_identity"),
    read("get_kernel_info"),
    read("get_disk_usage"),
    read("get_memory_usage"),
    read("zssh_read_file"),
    write,
  ];
  assert.equal(assertPublicToolScopeContract(tools), true);

  const wireOnly = tools.map(tool => {
    const { securitySchemes, ...rest } = tool;
    return rest;
  });
  assert.equal(assertPublicToolScopeContract(wireOnly), true);

  const topLevelDrift = tools.map(tool => tool.name === "get_profile"
    ? { ...tool, securitySchemes: [{ type: "oauth2", scopes: ["zssh:write"] }] }
    : tool);
  assert.throws(() => assertPublicToolScopeContract(topLevelDrift), /get_profile.*zssh:read/);

  const scopeDrift = tools.map(tool => tool.name === "zssh_write_file"
    ? {
        ...tool,
        securitySchemes: [{ type: "oauth2", scopes: ["zssh:read"] }],
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["zssh:read"] }] },
      }
    : tool);
  assert.throws(() => assertPublicToolScopeContract(scopeDrift), /zssh_write_file.*zssh:write/);

  assert.throws(
    () => assertPublicToolScopeContract([...tools, read("unreviewed_tool")]),
    /unreviewed tools: unreviewed_tool/
  );

  const metadataDrift = tools.map(tool => tool.name === "get_profile"
    ? { ...tool, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["zssh:write"] }] } }
    : tool);
  assert.throws(() => assertPublicToolScopeContract(metadataDrift), /get_profile.*zssh:read/);
});

test("public tool contract fingerprint is stable across ordering but changes with metadata", () => {
  const first = [
    { name: "write_file", annotations: { destructiveHint: true, readOnlyHint: false }, inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    { name: "get_profile", _meta: { "openai/profile": true }, annotations: { readOnlyHint: true, destructiveHint: false } },
  ];
  const reordered = [
    { annotations: { destructiveHint: false, readOnlyHint: true }, name: "get_profile", _meta: { "openai/profile": true } },
    { inputSchema: { properties: { path: { type: "string" } }, type: "object" }, name: "write_file", annotations: { readOnlyHint: false, destructiveHint: true } },
  ];
  const fingerprint = publicToolContractFingerprint(first);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, publicToolContractFingerprint(reordered));
  assert.notEqual(
    fingerprint,
    publicToolContractFingerprint([{ ...first[0], description: "changed review metadata" }, first[1]])
  );
});


test("production server info requires public OAuth pairing and can require outbound agent", () => {
  const outbound = {
    plugin_profile: "public",
    auth_mode: "oauth",
    pairing_required: true,
    transport: "outbound-agent",
    target_label: "Review target",
  };
  assert.deepEqual(
    validateProductionServerInfo(outbound, { requireOutboundAgent: true }),
    { public_policy_validated: true, outbound_agent_transport_validated: true },
  );

  const local = { ...outbound };
  delete local.transport;
  assert.deepEqual(
    validateProductionServerInfo(local),
    { public_policy_validated: true, outbound_agent_transport_validated: false },
  );
  assert.throws(
    () => validateProductionServerInfo(local, { requireOutboundAgent: true }),
    /required outbound-agent transport/,
  );
  assert.throws(
    () => validateProductionServerInfo({ ...outbound, auth_mode: "legacy" }, { requireOutboundAgent: true }),
    /public\+oauth\+pairing/,
  );
  assert.throws(
    () => validateProductionServerInfo({ ...outbound, hostname: "secret-host" }, { requireOutboundAgent: true }),
    /private field: hostname/,
  );
});
