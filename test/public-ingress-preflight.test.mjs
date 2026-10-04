import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPublicIngress,
  isPublicRoutableAddress,
} from "../scripts/check-public-ingress.mjs";

test("public address guard rejects private, documentation, benchmark, and link-local ranges", () => {
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.10.4",
    "172.20.0.1",
    "192.168.1.1",
    "192.0.2.10",
    "198.18.0.1",
    "198.51.100.8",
    "203.0.113.9",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:c0a8:101",
    "::8.8.8.8",
  ]) {
    assert.equal(isPublicRoutableAddress(address), false, address);
  }
  assert.equal(isPublicRoutableAddress("1.1.1.1"), true);
  assert.equal(isPublicRoutableAddress("2606:4700:4700::1111"), true);
});

test("external ingress preflight binds DNS, HTTPS health, MCP 401, and resource metadata to one origin", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init.method || "GET", redirect: init.redirect });
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "zssh", version: "0.1.2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/mcp") {
      return new Response("", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.zssh.dev/.well-known/oauth-protected-resource"',
        },
      });
    }
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return new Response(JSON.stringify({
        resource: "https://mcp.zssh.dev",
        authorization_servers: ["https://auth.zssh.dev"],
        scopes_supported: ["zssh:read", "zssh:write"],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected request " + url.href);
  };

  const result = await checkPublicIngress("https://mcp.zssh.dev/mcp", {
    lookupImpl: async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ],
    fetchImpl,
  });

  assert.deepEqual(result, {
    ok: true,
    mcp_url: "https://mcp.zssh.dev/mcp",
    endpoint_origin: "https://mcp.zssh.dev",
    dns_address_count: 2,
    dns_families: [4, 6],
    https_health_validated: true,
    unauthenticated_mcp_401_validated: true,
    protected_resource_metadata_validated: true,
  });
  assert.deepEqual(calls.map(call => call.url), [
    "https://mcp.zssh.dev/health",
    "https://mcp.zssh.dev/mcp",
    "https://mcp.zssh.dev/.well-known/oauth-protected-resource",
  ]);
  assert.ok(calls.every(call => call.redirect === "manual"));
});

test("external ingress preflight fails closed when DNS resolves to a non-public address", async () => {
  await assert.rejects(
    () => checkPublicIngress("https://mcp.zssh.dev/mcp", {
      lookupImpl: async () => [{ address: "192.168.1.20", family: 4 }],
      fetchImpl: async () => { throw new Error("fetch must not run"); },
    }),
    /publicly routable/,
  );
});

test("external ingress preflight rejects IPv4-mapped IPv6 DNS answers before fetch", async () => {
  await assert.rejects(
    () => checkPublicIngress("https://mcp.zssh.dev/mcp", {
      lookupImpl: async () => [{ address: "::ffff:7f00:1", family: 6 }],
      fetchImpl: async () => { throw new Error("fetch must not run"); },
    }),
    /publicly routable/,
  );
});

test("external ingress preflight refuses redirects before accepting health or MCP evidence", async () => {
  await assert.rejects(
    () => checkPublicIngress("https://mcp.zssh.dev/mcp", {
      lookupImpl: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchImpl: async () => new Response("", {
        status: 302,
        headers: { location: "https://other.zssh.dev/health" },
      }),
    }),
    /must not redirect/,
  );
});

test("external ingress preflight rejects non-standard HTTPS ports", async () => {
  await assert.rejects(
    () => checkPublicIngress("https://mcp.zssh.dev:8443/mcp", {
      lookupImpl: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchImpl: async () => { throw new Error("fetch must not run"); },
    }),
    /standard HTTPS port/,
  );
});
