import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  EntitlementStore,
  PLANS,
  UsageMeter,
  applyStripeEvent,
  createCheckoutSession,
  signAccountToken,
  verifyAccountToken,
  verifyStripeSignature,
} from "../billing.mjs";

const OWNER = "zssh_" + "c".repeat(32);
const env = {
  ZSSH_BILLING_LINK_SECRET: "s".repeat(40),
  ZSSH_STRIPE_SECRET_KEY: "sk_test_123",
  ZSSH_STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  ZSSH_STRIPE_PRICE_TEAM_YEARLY: "price_team_y",
};

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zssh-billing-"));
  return new EntitlementStore({ env: { ZSSH_BILLING_FILE: path.join(dir, "billing.json") } });
}

test("plans get more generous as they get more expensive", () => {
  const order = [PLANS.free, PLANS.pro, PLANS.team];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].max_servers > order[i - 1].max_servers);
    assert.ok(order[i].daily_actions > order[i - 1].daily_actions);
    assert.ok(order[i].price_eur.month > order[i - 1].price_eur.month);
  }
});

test("account links verify, expire, and resist tampering", () => {
  const now = Date.now();
  const token = signAccountToken(OWNER, { env, now });
  assert.equal(verifyAccountToken(token, { env, now }), OWNER);
  assert.equal(verifyAccountToken(token, { env, now: now + 2 * 3600 * 1000 }), null);
  assert.equal(verifyAccountToken(token, { env: { ZSSH_BILLING_LINK_SECRET: "t".repeat(40) }, now }), null);
  assert.equal(verifyAccountToken(token.replace(/.$/, c => (c === "A" ? "B" : "A")), { env, now }), null);
  assert.throws(() => signAccountToken(OWNER, { env: { ZSSH_BILLING_LINK_SECRET: "short" } }), /at least 32/);
});

test("usage meter enforces the daily limit and resets the next UTC day", () => {
  const meter = new UsageMeter();
  const day = Date.UTC(2026, 9, 23, 12);
  assert.equal(meter.consume(OWNER, 2, day).ok, true);
  assert.equal(meter.consume(OWNER, 2, day).ok, true);
  const blocked = meter.consume(OWNER, 2, day);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.resets_at, "2026-10-24T00:00:00.000Z");
  assert.equal(meter.consume(OWNER, 2, Date.UTC(2026, 9, 24, 1)).ok, true);
});

test("Stripe webhook signatures are verified with a time tolerance", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "ping" });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(t + "." + body).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${t - 3600},v1=${sig}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, ""), false);
});

test("subscription events move a profile between plans", async () => {
  const store = await tempStore();
  assert.equal((await store.get(OWNER)).plan, "free");
  await applyStripeEvent({ type: "checkout.session.completed", data: { object: { client_reference_id: OWNER, customer: "cus_1", subscription: "sub_1" } } }, store, env);
  await applyStripeEvent({ type: "customer.subscription.updated", data: { object: {
    id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { id: "price_team_y" } }] },
  } } }, store, env);
  assert.deepEqual([(await store.get(OWNER)).plan, (await store.get(OWNER)).interval], ["team", "year"]);
  await applyStripeEvent({ type: "customer.subscription.deleted", data: { object: {
    id: "sub_1", customer: "cus_1", status: "canceled", items: { data: [{ price: { id: "price_team_y" } }] },
  } } }, store, env);
  assert.equal((await store.get(OWNER)).plan, "free");
  assert.equal((await store.get(OWNER)).customer, "cus_1");
});

test("checkout binds the Stripe session to the signed-in profile", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: new URLSearchParams(init.body), auth: init.headers.authorization };
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/x" }), { status: 200 });
  };
  const url = await createCheckoutSession(
    { profileId: OWNER, plan: "pro", interval: "month", baseUrl: "https://zssh.example.com" },
    { env, fetchImpl },
  );
  assert.equal(url, "https://checkout.stripe.com/c/pay/x");
  assert.equal(sent.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(sent.body.get("line_items[0][price]"), "price_pro_m");
  assert.equal(sent.body.get("client_reference_id"), OWNER);
  assert.equal(sent.body.get("subscription_data[metadata][zssh_profile]"), OWNER);
  await assert.rejects(createCheckoutSession({ profileId: OWNER, plan: "pro", interval: "year", baseUrl: "x" }, { env, fetchImpl }), /unknown plan/);
});
