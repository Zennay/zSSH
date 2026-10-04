import test from "node:test";
import assert from "node:assert/strict";

import { renderM5BlockingIssue } from "../scripts/sync-m5-blocking-issue.mjs";

test("managed M5 handoff includes unresolved public ingress after DNS", () => {
  const readiness = {
    schema_version: 5,
    phase: "M5",
    execution_state: "external_input_only",
    blocking_gate: "dns_publication",
    blocking_action: {
      lane: "dns_publication",
      gate_kind: "provider_credentials",
      requires_external_input: true,
      action: "Provision the Cloudflare token.",
      missing: ["CLOUDFLARE_API_TOKEN"],
      invalid: [],
    },
    ready: {
      repository_governance: true,
      dns_publication: false,
      public_ingress: false,
      auth0_preflight: false,
      reviewer_fixture: false,
      portal_and_host_attestations: false,
    },
    next_actions: [
      { lane: "dns_publication" },
      { lane: "auth0_preflight" },
      { lane: "reviewer_fixture" },
      { lane: "portal_and_host_attestations" },
    ],
  };

  const rendered = renderM5BlockingIssue({
    readiness,
    canonicalSha: "0123456789abcdef0123456789abcdef01234567",
  });

  const ingress = rendered.body.indexOf("`public_ingress`");
  const auth0 = rendered.body.indexOf("`auth0_preflight`");

  assert.ok(ingress >= 0, "public_ingress should be listed as a later gate");
  assert.ok(auth0 >= 0, "auth0_preflight should remain listed");
  assert.ok(ingress < auth0, "public_ingress must be shown before auth0_preflight");
  assert.match(rendered.body, /Public gateway and Caddy ingress rollout/);
});
