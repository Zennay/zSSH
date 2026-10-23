import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

// Subscription plans for the hosted zSSH gateway. Limits are per zSSH profile
// (one OAuth account), counted in tool actions per UTC day. They are meant to
// be generous: the gateway only relays small JSON messages to the user's own
// VPS, so the real cost per action is tiny.
export const PLANS = Object.freeze({
  free: Object.freeze({
    id: "free",
    name: "Free",
    price_eur: { month: 0, year: 0 },
    max_servers: 1,
    daily_actions: 500,
    blurb: "One server, everything you need to try zSSH.",
  }),
  pro: Object.freeze({
    id: "pro",
    name: "Pro",
    price_eur: { month: 9, year: 90 },
    max_servers: 10,
    daily_actions: 25000,
    blurb: "For developers running a handful of VPSes.",
  }),
  team: Object.freeze({
    id: "team",
    name: "Team",
    price_eur: { month: 29, year: 290 },
    max_servers: 50,
    daily_actions: 150000,
    blurb: "For agencies and teams with a real fleet.",
  }),
});

export const PAID_PLAN_IDS = Object.freeze(["pro", "team"]);
const INTERVALS = Object.freeze(["month", "year"]);
const PROFILE_RE = /^zssh_[a-f0-9]{32}$/;
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function planFor(id) {
  return PLANS[id] || PLANS.free;
}

function profile(value) {
  const id = String(value || "");
  if (!PROFILE_RE.test(id)) throw new Error("invalid profile id");
  return id;
}

// ---------------------------------------------------------------------------
// Entitlements: which plan each profile is on. Same private-file discipline as
// the enrollment registry (0600 file in a 0700 directory, atomic replace).

function entitlementsFile(env) {
  return path.resolve(String(env.ZSSH_BILLING_FILE || "").trim() ||
    path.join(os.homedir(), ".config", "zssh", "billing.json"));
}

async function readJson(file) {
  let stat;
  try { stat = await fs.lstat(file); } catch (err) {
    if (err?.code === "ENOENT") return { version: 1, profiles: {}, customers: {} };
    throw err;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("billing state must be a private regular file");
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  if (parsed?.version !== 1 || typeof parsed.profiles !== "object" || typeof parsed.customers !== "object") {
    throw new Error("invalid billing registry");
  }
  return parsed;
}

async function writeJson(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + ".tmp-" + crypto.randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export class EntitlementStore {
  #file;
  #queue = Promise.resolve();

  constructor({ env = process.env } = {}) {
    this.#file = entitlementsFile(env);
  }

  #serialized(fn) {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  async get(profileId) {
    const owner = profile(profileId);
    const state = await readJson(this.#file);
    const entry = state.profiles[owner];
    const active = entry && entry.plan !== "free" && ACTIVE_STATUSES.has(entry.status);
    return {
      plan: active ? planFor(entry.plan).id : "free",
      status: entry?.status || "none",
      interval: entry?.interval || null,
      current_period_end: entry?.current_period_end || null,
      customer: entry?.customer || null,
    };
  }

  async set(profileId, patch) {
    const owner = profile(profileId);
    return this.#serialized(async () => {
      const state = await readJson(this.#file);
      const next = { ...(state.profiles[owner] || {}), ...patch, updated_at: new Date().toISOString() };
      state.profiles[owner] = next;
      if (next.customer) state.customers[next.customer] = owner;
      await writeJson(this.#file, state);
      return next;
    });
  }

  async profileForCustomer(customer) {
    const state = await readJson(this.#file);
    return state.customers[String(customer || "")] || null;
  }
}

// ---------------------------------------------------------------------------
// Daily action meter. Kept in memory: a gateway restart resets today's count,
// which only ever errs in the user's favour.

export class UsageMeter {
  #days = new Map();

  #bucket(now) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (!this.#days.has(day)) {
      this.#days.clear();
      this.#days.set(day, new Map());
    }
    return { day, counts: this.#days.get(day) };
  }

  static resetsAt(now = Date.now()) {
    const d = new Date(now);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
  }

  used(profileId, now = Date.now()) {
    return this.#bucket(now).counts.get(profileId) || 0;
  }

  consume(profileId, limit, now = Date.now()) {
    const { counts } = this.#bucket(now);
    const used = counts.get(profileId) || 0;
    if (used >= limit) return { ok: false, used, limit, resets_at: UsageMeter.resetsAt(now) };
    counts.set(profileId, used + 1);
    return { ok: true, used: used + 1, limit, resets_at: UsageMeter.resetsAt(now) };
  }
}

// ---------------------------------------------------------------------------
// Signed account links. The plugin hands the signed-in user a short-lived link
// to the website, so the website never needs its own password system: the
// OAuth login inside ChatGPT/Claude is the identity.

const LINK_TTL_MS = 60 * 60 * 1000;

function linkSecret(env) {
  const secret = String(env.ZSSH_BILLING_LINK_SECRET || "");
  if (secret.length < 32) throw new Error("ZSSH_BILLING_LINK_SECRET must be at least 32 characters");
  return secret;
}

export function signAccountToken(profileId, { env = process.env, now = Date.now() } = {}) {
  const payload = Buffer.from(JSON.stringify({ p: profile(profileId), e: now + LINK_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", linkSecret(env)).update(payload).digest("base64url");
  return "acct_" + payload + "." + sig;
}

export function verifyAccountToken(token, { env = process.env, now = Date.now() } = {}) {
  const match = /^acct_([A-Za-z0-9_-]{10,200})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""));
  if (!match) return null;
  // Compare the canonical encoding, not decoded bytes: base64url decoding
  // ignores the unused low bits of the last character.
  const expected = Buffer.from(crypto.createHmac("sha256", linkSecret(env)).update(match[1]).digest("base64url"));
  const actual = Buffer.from(match[2]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    if (!PROFILE_RE.test(p) || !Number.isFinite(e) || e < now) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stripe (REST over fetch, no SDK dependency).

export function stripePriceId(plan, interval, env = process.env) {
  if (!PAID_PLAN_IDS.includes(plan) || !INTERVALS.includes(interval)) return null;
  const key = "ZSSH_STRIPE_PRICE_" + plan.toUpperCase() + "_" + (interval === "year" ? "YEARLY" : "MONTHLY");
  return String(env[key] || "").trim() || null;
}

export function planForPriceId(priceId, env = process.env) {
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of INTERVALS) {
      if (priceId && stripePriceId(plan, interval, env) === priceId) return { plan, interval };
    }
  }
  return null;
}

async function stripe(pathname, params, { env = process.env, fetchImpl = fetch } = {}) {
  const key = String(env.ZSSH_STRIPE_SECRET_KEY || "");
  if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("ZSSH_STRIPE_SECRET_KEY is not configured");
  const response = await fetchImpl("https://api.stripe.com" + pathname, {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Stripe request failed: " + (value?.error?.message || response.status));
  return value;
}

export async function createCheckoutSession({ profileId, plan, interval, customer, baseUrl }, options = {}) {
  const env = options.env || process.env;
  const price = stripePriceId(plan, interval, env);
  if (!price) throw new Error("unknown plan or billing interval");
  const owner = profile(profileId);
  const params = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: owner,
    "metadata[zssh_profile]": owner,
    "subscription_data[metadata][zssh_profile]": owner,
    allow_promotion_codes: "true",
    success_url: baseUrl + "/account/welcome",
    cancel_url: baseUrl + "/pricing",
  };
  if (customer) params.customer = customer;
  const session = await stripe("/v1/checkout/sessions", params, options);
  return session.url;
}

export async function createPortalSession({ customer, baseUrl }, options = {}) {
  if (!customer) throw new Error("no Stripe customer for this account yet");
  const session = await stripe("/v1/billing_portal/sessions", { customer, return_url: baseUrl + "/pricing" }, options);
  return session.url;
}

export function verifyStripeSignature(rawBody, header, secret, { now = Date.now(), toleranceSeconds = 300 } = {}) {
  if (!secret) return false;
  const parts = Object.create(null);
  const signatures = [];
  for (const item of String(header || "").split(",")) {
    const [k, v] = item.split("=");
    if (k === "v1") signatures.push(v);
    else if (k && v) parts[k] = v;
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSeconds || !signatures.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + rawBody).digest();
  return signatures.some(sig => {
    const actual = Buffer.from(String(sig), "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

// Apply one verified Stripe event to the entitlement store.
export async function applyStripeEvent(event, store, env = process.env) {
  const object = event?.data?.object || {};
  if (event?.type === "checkout.session.completed") {
    const owner = object.client_reference_id || object.metadata?.zssh_profile;
    if (!PROFILE_RE.test(String(owner || ""))) return { handled: false };
    await store.set(owner, { customer: object.customer || null, subscription: object.subscription || null });
    return { handled: true, profile: owner };
  }
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event?.type)) {
    const owner = object.metadata?.zssh_profile || await store.profileForCustomer(object.customer);
    if (!PROFILE_RE.test(String(owner || ""))) return { handled: false };
    const mapped = planForPriceId(object.items?.data?.[0]?.price?.id, env);
    const status = event.type === "customer.subscription.deleted" ? "canceled" : String(object.status || "");
    await store.set(owner, {
      plan: mapped && ACTIVE_STATUSES.has(status) ? mapped.plan : "free",
      interval: mapped?.interval || null,
      status,
      customer: object.customer || null,
      subscription: object.id || null,
      current_period_end: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null,
    });
    return { handled: true, profile: owner };
  }
  return { handled: false };
}
