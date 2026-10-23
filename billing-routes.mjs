import {
  PAID_PLAN_IDS,
  UsageMeter,
  applyStripeEvent,
  createCheckoutSession,
  createPortalSession,
  planFor,
  signAccountToken,
  verifyAccountToken,
  verifyStripeSignature,
} from "./billing.mjs";
import { accountPageResponse, messagePageResponse } from "./public-site.mjs";

const BILLING_PATHS = new Set(["/account", "/checkout", "/billing/portal", "/stripe/webhook"]);
const MAX_WEBHOOK_BYTES = 262144;

async function readRaw(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, page) {
  res.writeHead(page.status, page.headers).end(page.body);
}

function redirect(res, location) {
  res.writeHead(303, { location, "cache-control": "no-store", "referrer-policy": "no-referrer" }).end();
}

const expiredLink = () => messagePageResponse(403, "Link expired",
  "This account link is no longer valid. Ask zSSH in ChatGPT or Claude for “my zSSH account” to get a fresh one.");

// Website half of billing. Returns true when the request was handled.
// Identity comes only from the short-lived signed link the plugin gives the
// signed-in user (get_account → manage_url); the website has no passwords.
export async function handleBillingRequest(req, res, url, { entitlements, usage, enrollment, baseUrl, env = process.env }) {
  if (!BILLING_PATHS.has(url.pathname)) return false;
  if (!entitlements) {
    send(res, messagePageResponse(404, "Billing unavailable", "This zSSH gateway is self-hosted and has no subscriptions."));
    return true;
  }

  if (url.pathname === "/stripe/webhook") {
    if (req.method !== "POST") return res.writeHead(405).end(), true;
    let raw;
    try { raw = await readRaw(req, MAX_WEBHOOK_BYTES); } catch { return res.writeHead(413).end(), true; }
    if (!verifyStripeSignature(raw, req.headers["stripe-signature"], env.ZSSH_STRIPE_WEBHOOK_SECRET)) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_signature" }));
      return true;
    }
    try {
      const outcome = await applyStripeEvent(JSON.parse(raw), entitlements, env);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ received: true, handled: outcome.handled }));
    } catch (err) {
      console.error("zSSH Stripe webhook failed:", err?.message || err);
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "webhook_failed" }));
    }
    return true;
  }

  if (req.method !== "GET") return res.writeHead(405).end(), true;
  const owner = verifyAccountToken(url.searchParams.get("t"), { env });
  if (!owner) {
    send(res, expiredLink());
    return true;
  }

  try {
    const entitlement = await entitlements.get(owner);
    if (url.pathname === "/account") {
      const plan = planFor(entitlement.plan);
      send(res, accountPageResponse({
        plan,
        entitlement,
        servers: enrollment ? (await enrollment.list(owner)).length : 0,
        actionsToday: usage ? usage.used(owner) : 0,
        resetsAt: UsageMeter.resetsAt(),
        token: signAccountToken(owner, { env }),
        canManage: Boolean(entitlement.customer),
      }));
      return true;
    }
    if (url.pathname === "/checkout") {
      const plan = url.searchParams.get("plan");
      const interval = url.searchParams.get("interval") === "year" ? "year" : "month";
      if (!PAID_PLAN_IDS.includes(plan)) {
        send(res, messagePageResponse(400, "Unknown plan", "Pick Pro or Team on the pricing page."));
        return true;
      }
      redirect(res, await createCheckoutSession({
        profileId: owner, plan, interval, customer: entitlement.customer, baseUrl,
      }, { env }));
      return true;
    }
    // /billing/portal
    redirect(res, await createPortalSession({ customer: entitlement.customer, baseUrl }, { env }));
    return true;
  } catch (err) {
    console.error("zSSH billing request failed:", err?.message || err);
    send(res, messagePageResponse(502, "Billing is temporarily unavailable", "Please try again in a minute."));
    return true;
  }
}
