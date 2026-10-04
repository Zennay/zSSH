import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../.github/workflows/public-dns-publish.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

test("production DNS publish proves external convergence before reporting success", () => {
  assert.match(
    workflow,
    /Prove public DNS convergence and expose the next live stage[\s\S]*observe-public-origin-readiness\.mjs "\$MCP_URL"/,
  );
  assert.match(workflow, /for attempt in 1 2 3 4 5 6; do/);
  assert.match(
    workflow,
    /if \[ "\$STAGE" != "dns" \]; then[\s\S]*ZSSH_PRODUCTION_DNS_EXTERNALLY_RESOLVABLE stage=\$STAGE/,
  );
  assert.match(
    workflow,
    /Public DNS still does not resolve after bounded convergence checks/,
  );
});

test("post-publication origin evidence is retained with Cloudflare DNS evidence", () => {
  assert.match(
    workflow,
    /zssh-cloudflare-dns-verify\.json[\s\S]*zssh-public-origin-after-dns\.json/,
  );
});


test("reviewed marker can trigger the exact production DNS publish after main is protected", () => {
  assert.match(workflow, /push:\n    branches: \[main\][\s\S]*\.github\/openai-production-dns-trigger/);
  assert.match(workflow, /test "\$\(cat \.github\/openai-production-dns-trigger\)" = "PUBLISH_ZSSH_PRODUCTION_DNS"/);
  assert.match(workflow, /node scripts\/check-main-provenance\.mjs/);
  assert.match(workflow, /check-main-protection\.mjs --public-status --require-protected/);
  assert.match(
    workflow,
    /ZSSH_PUBLIC_BASE_URL: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.public_base_url \|\| 'https:\/\/zssh\.cheapgpt\.shop' \}\}/,
  );
  assert.match(
    workflow,
    /ZSSH_PUBLIC_IPV4: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.ipv4 \|\| '198\.244\.191\.182' \}\}/,
  );
});

test("manual DNS publication still requires explicit confirmation", () => {
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'[\s\S]*PUBLISH_ZSSH_PRODUCTION_DNS/);
});

test("manual production DNS dispatch cannot override the canonical hostname or IPv4", () => {
  const dispatchBlock = workflow.match(/  workflow_dispatch:[\s\S]*?\n\npermissions:/)?.[0] || "";
  assert.doesNotMatch(dispatchBlock, /public_base_url:/);
  assert.doesNotMatch(dispatchBlock, /ipv4:/);
  assert.match(workflow, /ZSSH_PUBLIC_BASE_URL: https:\/\/zssh\.cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_IPV4: 198\.244\.191\.182/);
});
