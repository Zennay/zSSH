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
  assert.match(workflow, /CLOUDFLARE_ZONE_NAME: cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_BASE_URL: https:\/\/zssh\.cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_IPV4: 198\.244\.191\.182/);
});

test("production DNS target cannot be overridden by manual dispatch inputs", () => {
  assert.doesNotMatch(workflow, /^      public_base_url:/m);
  assert.doesNotMatch(workflow, /^      ipv4:/m);
  assert.doesNotMatch(workflow, /inputs\.public_base_url/);
  assert.doesNotMatch(workflow, /inputs\.ipv4/);
  assert.match(workflow, /CLOUDFLARE_ZONE_NAME: cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_BASE_URL: https:\/\/zssh\.cheapgpt\.shop/);
  assert.match(workflow, /ZSSH_PUBLIC_IPV4: 198\.244\.191\.182/);
});

test("manual production DNS dispatch is bound to the current protected main revision", () => {
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*test "\$GITHUB_REF" = "refs\/heads\/main"/,
  );
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*node scripts\/check-main-provenance\.mjs/,
  );
  assert.match(
    workflow,
    /Require canonical protected-main manual DNS dispatch[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
  );
});

test("manual DNS publication still requires explicit confirmation", () => {
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'[\s\S]*PUBLISH_ZSSH_PRODUCTION_DNS/);
});


test("production DNS workflow pins all reusable actions to immutable commit SHAs", () => {
  assert.match(
    workflow,
    /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4/,
  );
  assert.match(
    workflow,
    /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/,
  );
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/,
  );
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\s|$)/);
});
