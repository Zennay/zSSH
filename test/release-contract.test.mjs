import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  assertExactBearerResourceMetadata,
  fetchNoRedirect,
  isNonPublicHostname,
  protectedResourceMetadataUrl,
  publicToolContractFingerprint,
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
});

test("private-host detection covers loopback, RFC1918, link-local, and reserved suffixes", () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.4", "169.254.1.2", "demo.local", "demo.test"]) {
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
