import test from "node:test";
import assert from "node:assert/strict";
import { publicListingPaths, publicSiteResponse } from "../public-site.mjs";

test("public review site exposes exactly the required listing pages", () => {
  assert.deepEqual(publicListingPaths(), ["/", "/support", "/privacy", "/terms"]);
  for (const path of publicListingPaths()) {
    const response = publicSiteResponse(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers["content-type"], /^text\/html/);
    assert.match(response.headers["content-security-policy"], /default-src 'none'/);
    assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.match(response.body, /zSSH/);
  }
});

test("public review site does not expose unknown routes", () => {
  assert.equal(publicSiteResponse("/mcp"), null);
  assert.equal(publicSiteResponse("/admin"), null);
});

test("public review pages explain the owner-controlled linking boundary", () => {
  const overview = publicSiteResponse("/").body;
  const privacy = publicSiteResponse("/privacy").body;
  assert.match(overview, /one-use install command/i);
  assert.match(overview, /Shell access is a per-server opt-in/i);
  assert.match(overview, /outbound-only agent/i);
  assert.match(privacy, /OAuth authentication alone does not authorize a target/i);
});

test("site pages contain no script and pricing mirrors the billing plans", async () => {
  const { PLANS } = await import("../billing.mjs");
  for (const path of ["/", "/pricing", "/docs", "/account/welcome", ...publicListingPaths()]) {
    const response = publicSiteResponse(path);
    assert.equal(response.status, 200, path);
    assert.doesNotMatch(response.body, /<script/i, path);
  }
  const pricing = publicSiteResponse("/pricing").body;
  for (const plan of Object.values(PLANS)) {
    assert.match(pricing, new RegExp(plan.daily_actions.toLocaleString("en-US")));
    assert.match(pricing, new RegExp("€" + plan.price_eur.year));
  }
});

test("account page escapes values and never caches", async () => {
  const { accountPageResponse, messagePageResponse } = await import("../public-site.mjs");
  const { planFor } = await import("../billing.mjs");
  const page = accountPageResponse({
    plan: planFor("free"),
    entitlement: { status: "none", current_period_end: null },
    servers: 1,
    actionsToday: 42,
    resetsAt: "2026-01-02T00:00:00.000Z",
    token: "acct_a\"<b>.sig",
    canManage: false,
  });
  assert.equal(page.headers["cache-control"], "no-store");
  assert.doesNotMatch(page.body, /acct_a"<b>/);
  assert.match(page.body, /t=acct_a%22%3Cb%3E\.sig/);
  assert.match(page.body, /plan=pro&amp;interval=month/);
  assert.doesNotMatch(page.body, /billing\/portal/);
  const message = messagePageResponse(403, "<x>", "a & b");
  assert.equal(message.status, 403);
  assert.match(message.body, /&lt;x&gt;/);
});


test("public privacy page contains the minimum directory disclosures", () => {
  const privacy = publicSiteResponse("/privacy").body;
  for (const heading of ["Data categories", "Purpose", "Recipients", "Retention", "User controls"]) {
    assert.match(privacy, new RegExp("<h2>" + heading + "</h2>", "i"));
  }
  assert.match(privacy, /15 minutes by default/i);
  assert.match(privacy, /does not keep a separate conversation history/i);
  assert.match(privacy, /ChatGPT or another MCP client provider processes data under its own terms and privacy policy/i);
  assert.match(privacy, /target owner can approve or immediately revoke pairing/i);
  assert.match(privacy, /passwords, private keys, bearer tokens, API keys, MFA\/OTP codes/i);
});


test("public support page exposes actionable support and private security contact routes", () => {
  const support = publicSiteResponse("/support").body;
  assert.match(support, /<h2>Contact support<\/h2>/i);
  assert.match(support, /href="https:\/\/github\.com\/Zennay\/zSSH\/issues"/i);
  assert.match(support, /href="https:\/\/github\.com\/Zennay\/zSSH\/security\/advisories\/new"/i);
  assert.match(support, /Never post passwords, private keys, bearer tokens, API keys, MFA\/OTP codes, capability URLs/i);
});
