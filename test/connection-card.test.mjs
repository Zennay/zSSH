import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../ui/connection-card.html", import.meta.url), "utf8");

test("connection card has a mobile-safe inline layout", () => {
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(html, /@media \(max-width: 360px\)/);
  assert.match(html, /\.top \{[^}]*min-width: 0;[^}]*display: flex;/s);
  assert.match(html, /\.value \{[^}]*min-width: 0;[^}]*flex: 1 1 auto;/s);
  assert.match(html, /button \{[^}]*min-height: 44px;/s);
  assert.match(html, /@media \(max-width: 360px\)[\s\S]*?button \{ width: 100%; \}/);
  assert.doesNotMatch(html, /overflow\s*:\s*(?:auto|scroll)/i);
  assert.equal((html.match(/<button\b/g) || []).length, 1);
});

test("connection card narrows assistive announcements to status content", () => {
  assert.match(
    html,
    /id="status" class="badge" role="status" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(
    html,
    /id="note" class="note" aria-live="polite" aria-atomic="true"/,
  );
  assert.doesNotMatch(html, /<main\b[^>]*aria-live=/i);
  assert.match(html, /refreshEl\.setAttribute\("aria-busy", "true"\)/);
  assert.match(html, /refreshEl\.removeAttribute\("aria-busy"\)/);
});

test("connection card remains self-contained", () => {
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /<script\b[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link\b[^>]+\bhref=/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /Approval stays local to the Linux target\./);
});
