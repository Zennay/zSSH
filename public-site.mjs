const HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
});

const NAV = '<nav><a href="/">Overview</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></nav>';

function page(title, description, body) {
  const safeTitle = String(title);
  const safeDescription = String(description);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${safeDescription}">
<title>${safeTitle} · zSSH</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{max-width:760px;margin:0 auto;padding:48px 24px 72px;line-height:1.6}
nav{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 40px}
a{color:inherit}.hero{font-size:clamp(2rem,6vw,4rem);line-height:1.05;margin:.2em 0}
.lead{font-size:1.15rem;max-width:62ch}
.card{border:1px solid currentColor;border-radius:14px;padding:18px;margin:18px 0}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
footer{margin-top:48px;font-size:.9rem;opacity:.75}
</style>
</head>
<body>
${NAV}
<main>${body}</main>
<footer>zSSH · secure, owner-controlled access to a paired Linux target.</footer>
</body>
</html>`;
}

const PAGES = new Map([
  ["/", page(
    "Secure Linux access",
    "zSSH connects an authenticated user to an explicitly paired, owner-controlled Linux target.",
    `<p>Developer tool</p><h1 class="hero">Your Linux target stays yours.</h1>
<p class="lead">zSSH is a remote MCP service for narrowly scoped Linux operations. OAuth identifies the caller; the Linux owner must separately approve pairing on the target before target-specific tools can run.</p>
<section class="card"><h2>Trust boundary</h2><p>zSSH does not require storing a user's SSH private key in ChatGPT. Public tools are capability-scoped, generic shell execution is not exposed, filesystem access is restricted to configured public roots, and pairing can be revoked locally.</p></section>
<section class="card"><h2>Connection flow</h2><ol><li>Connect the published zSSH MCP endpoint from ChatGPT.</li><li>Sign in through the configured OAuth provider.</li><li>Create a short-lived pairing request.</li><li>Approve that request locally on the Linux target.</li><li>Use only the reviewed capabilities granted to that profile.</li></ol></section>
<p>For security and privacy details, see <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>. For help, see <a href="/support">Support</a>.</p>`
  )],
  ["/privacy", page(
    "Privacy",
    "How zSSH handles authentication, target data, audit records, and secrets.",
    `<h1>Privacy</h1>
<p>zSSH is designed to minimize centrally handled data. The public service processes authentication claims and the MCP requests needed to perform user-requested operations on a paired Linux target.</p>
<h2>Data handled</h2><ul><li>OAuth identity and scopes needed to authorize a request.</li><li>Pairing state and a stable opaque profile identifier.</li><li>Tool inputs and bounded tool results required to perform the requested operation.</li><li>Security audit events on the target.</li></ul>
<h2>Secrets</h2><p>Do not use zSSH to retrieve or store passwords, private keys, bearer tokens, or other credentials. The public profile blocks common credential paths and secret-like file content. Access tokens are authentication material and are never intentionally returned as tool output.</p>
<h2>Target ownership</h2><p>Pairing approval and revocation remain controlled by the Linux target owner. OAuth authentication alone does not authorize a target.</p>`
  )],
  ["/terms", page(
    "Terms",
    "Usage conditions for the zSSH public MCP service.",
    `<h1>Terms</h1>
<p>Use zSSH only on Linux systems you own or are explicitly authorized to administer. You are responsible for the commands, files, and target permissions you intentionally expose through your local zSSH configuration.</p>
<p>The public profile is intentionally limited. It may refuse paths, content, or operations that create a credential-exposure or destructive-operation risk. Do not attempt to bypass those controls.</p>
<p>Service availability is not guaranteed. Keep an independent recovery path for critical infrastructure.</p>`
  )],
  ["/support", page(
    "Support",
    "Support and troubleshooting guidance for zSSH.",
    `<h1>Support</h1>
<p>Before reporting a problem, confirm that the public endpoint is reachable, OAuth discovery succeeds, the target is locally paired, and the requested path is inside the configured public roots.</p>
<h2>Useful diagnostics</h2><ul><li><code>GET /health</code> should return a healthy zSSH service response.</li><li>The OAuth protected-resource document should be available at <code>/.well-known/oauth-protected-resource</code>.</li><li>Pairing must be approved locally on the target; the remote service cannot self-approve access.</li></ul>
<p>Project support and source history are maintained at <a href="https://github.com/Zennay/zSSH">github.com/Zennay/zSSH</a>.</p>`
  )],
]);

export function publicSiteResponse(pathname) {
  const normalized = pathname === "/" ? "/" : String(pathname || "").replace(/\/+$/, "");
  const body = PAGES.get(normalized);
  if (!body) return null;
  return { status: 200, headers: { ...HEADERS }, body };
}

export function publicListingPaths() {
  return ["/", "/support", "/privacy", "/terms"];
}
