import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

test("Caddy ingress examples preserve private/public service isolation", () => {
  const privateExample = read("deploy/Caddyfile.example");
  const publicExample = read("deploy/Caddyfile.public.example");
  const installer = read("deploy/install-public-gateway.sh");
  const readme = read("README.md");

  assert.match(privateExample, /reverse_proxy\s+127\.0\.0\.1:8788\b/);
  assert.doesNotMatch(privateExample, /reverse_proxy\s+127\.0\.0\.1:8789\b/);
  assert.match(privateExample, /private zssh\.service default/i);

  assert.match(publicExample, /reverse_proxy\s+127\.0\.0\.1:8789\b/);
  assert.doesNotMatch(publicExample, /reverse_proxy\s+127\.0\.0\.1:8788\b/);
  assert.match(publicExample, /zssh-public\.service/);

  assert.match(installer, /ZSSH_PUBLIC_GATEWAY_PORT:-8789/);
  assert.match(readme, /Caddyfile\.public\.example/);
  assert.match(readme, /public[^\n]*gateway[^\n]*port \*\*8789\*\*/i);
});
