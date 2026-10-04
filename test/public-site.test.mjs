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

test("public review pages explain the local-pairing security boundary", () => {
  const overview = publicSiteResponse("/").body;
  const privacy = publicSiteResponse("/privacy").body;
  assert.match(overview, /Linux owner must separately approve pairing/i);
  assert.match(overview, /generic shell execution is not exposed/i);
  assert.match(privacy, /OAuth authentication alone does not authorize a target/i);
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
