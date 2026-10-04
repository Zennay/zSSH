import test from "node:test";
import assert from "node:assert/strict";

import { buildProductionReadinessAudit } from "../scripts/check-production-readiness-audit.mjs";
import { renderM5BlockingIssue } from "../scripts/sync-m5-blocking-issue.mjs";

test("DNS credential handoff requires the Cloudflare user-token path used by the verifier", () => {
  const readiness = buildProductionReadinessAudit({
    ZSSH_MAIN_PROTECTION_VERIFIED: "1",
    ZSSH_MAIN_BRANCH_PROTECTED: "1",
    ZSSH_PUBLIC_ORIGIN_STAGE: "dns",
  });

  assert.equal(readiness.blocking_gate, "dns_publication");
  assert.equal(readiness.blocking_action?.gate_kind, "provider_credentials");
  assert.equal(readiness.blocking_action?.requires_external_input, true);

  const action = readiness.blocking_action?.action || "";
  assert.match(action, /user-owned Cloudflare API token/);
  assert.match(action, /My Profile > API Tokens/);
  assert.match(action, /Zone > DNS > Edit/);
  assert.match(action, /Zone > Zone > Read/);
  assert.match(action, /do not use an account-owned token/i);
  assert.match(action, /\/user\/tokens\/verify/);

  const issue = renderM5BlockingIssue({
    readiness,
    canonicalSha: "a".repeat(40),
  });

  assert.match(issue.body, /user-owned Cloudflare API token/);
  assert.match(issue.body, /My Profile > API Tokens/);
  assert.match(issue.body, /do not use an account-owned token/i);
  assert.match(issue.body, /\/user\/tokens\/verify/);
});
