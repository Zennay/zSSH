import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../.github/workflows/public-ingress-rollout.yml", import.meta.url),
  "utf8",
);

test("public ingress rollout is an explicit guarded manual production mutation", () => {
  assert.match(workflow, /workflow_dispatch:\n    inputs:/);
  assert.match(workflow, /PROMOTE_ZSSH_PUBLIC_INGRESS/);
  assert.match(workflow, /environment: openai-production/);
  assert.match(workflow, /concurrency:[\s\S]*group: zssh-public-ingress-rollout[\s\S]*cancel-in-progress: false/);
});

test("rollout proves canonical protected main before self-hosted mutation", () => {
  assert.match(
    workflow,
    /provenance:[\s\S]*runs-on: ubuntu-latest[\s\S]*check-main-provenance\.mjs[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha[\s\S]*check-main-protection\.mjs --require-negative-proof/,
  );
  assert.match(
    workflow,
    /rollout:[\s\S]*needs: provenance[\s\S]*runs-on:\n      - self-hosted\n      - haxlab/,
  );
  assert.match(
    workflow,
    /Re-check exact current protected main immediately before VPS mutation[\s\S]*check-main-protection\.mjs --public-status --require-protected --require-current-sha/,
  );
});

test("rollout requires exact production DNS before touching the gateway", () => {
  const dnsIndex = workflow.indexOf("Require exact production DNS convergence");
  const gatewayIndex = workflow.indexOf("Promote isolated public gateway");
  assert.ok(dnsIndex >= 0 && gatewayIndex > dnsIndex);
  assert.match(workflow, /198\.244\.191\.182/);
  assert.match(workflow, /resolve4\("zssh\.cheapgpt\.shop"\)/);
});

test("rollout validates both deployment helpers before mutation", () => {
  assert.match(workflow, /ZSSH_PUBLIC_GATEWAY_VALIDATE_ONLY: "1"/);
  assert.match(workflow, /ZSSH_CADDY_VALIDATE_ONLY: "1"/);
  assert.match(workflow, /bash deploy\/install-public-gateway\.sh/);
  assert.match(workflow, /bash deploy\/install-public-caddy\.sh/);
});

test("reviewer target identity comes from the local one-target trust boundary", () => {
  assert.match(workflow, /reviewer trust file must contain exactly one opaque zSSH target/);
  assert.match(workflow, /ZSSH_AGENT_PUBLIC_KEYS_FILE: \$\{\{ steps\.rollout_inputs\.outputs\.trust_file \}\}/);
  assert.match(workflow, /ZSSH_PUBLIC_ALLOWED_ROOTS: \/srv\/zssh-review/);
});

test("challenge token is scoped only to the gateway promotion step", () => {
  const rolloutBlock = workflow.split("      - name: Promote isolated public gateway")[1] || "";
  const step = rolloutBlock.split("\n      - name:")[0] || "";
  assert.ok(step.includes("OPENAI_APPS_CHALLENGE_TOKEN: ${{ secrets.OPENAI_APPS_CHALLENGE_TOKEN }}"));
  const before = workflow.split("      - name: Promote isolated public gateway")[0] || "";
  assert.doesNotMatch(before, /secrets\.OPENAI_APPS_CHALLENGE_TOKEN/);
});
