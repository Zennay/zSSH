import { PLANS } from "./billing.mjs";

// The public zSSH website: marketing pages, pricing, docs and the
// account/billing pages reached through the plugin's signed manage link.
// Everything is static HTML with inline CSS; there is no client-side script.

const BASE_HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
});
const HEADERS = Object.freeze({ ...BASE_HEADERS, "cache-control": "public, max-age=300" });
const PRIVATE_HEADERS = Object.freeze({ ...BASE_HEADERS, "cache-control": "no-store", "x-robots-tag": "noindex" });

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmt = n => Number.isFinite(n) ? n.toLocaleString("en-US") : "Unlimited";

const CSS = `
:root{
  --bg:#edf2f0;--surface:#f7faf9;--surface-2:#fbfdfc;
  --ink:#13243a;--ink-2:#2b3d52;--muted:#7a8a95;--faint:#a9b6bd;
  --line:#d6e0dc;--line-2:#c4d0cb;--hatch:#9fb0b8;--dot:#1c2f45;
  --pill:#13243a;--pill-ink:#f4f8f6;--ok:#2f8f6a;
  --shadow:0 1px 0 rgba(255,255,255,.7) inset,0 30px 60px -30px rgba(19,36,58,.18),0 8px 24px -12px rgba(19,36,58,.10);
  --radius:22px;
  --font:"Outfit","Jost","Lexend","Avenir Next","Avenir","Century Gothic","Futura","Segoe UI Variable Display","Segoe UI",ui-sans-serif,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d1620;--surface:#132230;--surface-2:#172838;
  --ink:#e6eef0;--ink-2:#c4d2d8;--muted:#8295a2;--faint:#5c6f7c;
  --line:#1f3242;--line-2:#2a4052;--hatch:#3f586b;--dot:#d9e6ea;
  --pill:#e6eef0;--pill-ink:#0d1620;--ok:#5cc79c;
  --shadow:0 1px 0 rgba(255,255,255,.04) inset,0 30px 60px -30px rgba(0,0,0,.6);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-weight:300;line-height:1.6;letter-spacing:.005em;-webkit-font-smoothing:antialiased;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:
  radial-gradient(1200px 600px at 85% -10%,rgba(255,255,255,.75),transparent 60%),
  radial-gradient(900px 500px at -10% 30%,rgba(255,255,255,.45),transparent 60%)}
@media (prefers-color-scheme:dark){body::before{background:radial-gradient(1000px 500px at 85% -10%,rgba(80,130,150,.14),transparent 60%)}}
a{color:inherit;text-decoration:none}
a:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:8px}
code{font-family:var(--mono);font-size:.86em}
.wrap{width:min(1180px,100% - 40px);margin-inline:auto}
.num{font-variant-numeric:tabular-nums lining-nums;font-weight:200;letter-spacing:-.035em;line-height:.95}
.eyebrow{font-size:.82rem;color:var(--muted);letter-spacing:.02em;font-style:italic}
.muted{color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

header.top{position:sticky;top:0;z-index:20;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);background:color-mix(in srgb,var(--bg) 72%,transparent);border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.bar{display:flex;align-items:center;gap:28px;height:68px}
.brand{display:flex;align-items:center;gap:10px;font-weight:400;font-size:1.12rem;letter-spacing:-.01em}
.mark{width:28px;height:28px;border-radius:9px;background:var(--pill);display:grid;place-items:center}
.mark svg{width:16px;height:16px}
.bar nav{display:flex;gap:26px;margin-left:12px;font-size:.95rem;color:var(--ink-2)}
.bar nav a:hover{color:var(--ink)}
.bar .spacer{flex:1}
.btn{display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 22px;border-radius:999px;font-size:.95rem;font-weight:400;border:1px solid var(--line-2);background:var(--surface-2);color:var(--ink);transition:transform .15s ease,box-shadow .15s ease}
.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px -14px rgba(19,36,58,.45)}
.btn.dark{background:var(--pill);color:var(--pill-ink);border-color:var(--pill)}
.btn.sm{height:38px;padding:0 16px;font-size:.88rem}
.btn .arrow{display:inline-block;transition:transform .15s}
.btn:hover .arrow{transform:translateX(3px)}
.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);font-size:.82rem;color:var(--ink-2)}
.dotlive{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 18%,transparent);display:inline-block;flex:none}

.hero{position:relative;padding:84px 0 40px;display:grid;grid-template-columns:1.12fr .88fr;gap:40px;align-items:center}
.hero h1{font-weight:200;font-size:clamp(2.9rem,6vw,5.4rem);line-height:.98;letter-spacing:-.045em;margin:22px 0}
.hero h1 em{font-style:italic;font-weight:200;color:var(--muted)}
.hero .lead{font-size:1.18rem;color:var(--ink-2);max-width:34ch;margin:0 0 34px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.hero .fine{margin-top:22px;font-size:.85rem;color:var(--muted)}
.stage{perspective:1800px;position:relative;min-height:540px}
.panel{position:absolute;inset:0 -60px 0 0;background:var(--surface);border:1px solid var(--line);border-radius:30px;box-shadow:var(--shadow);transform:rotateX(16deg) rotateY(-14deg) rotateZ(7deg);transform-origin:30% 40%;padding:40px 44px;overflow:hidden}
.panel::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,color-mix(in srgb,var(--surface) 92%,transparent));pointer-events:none}
.panel h3{margin:0;font-weight:400;font-size:1.35rem;letter-spacing:-.01em}
.k{font-size:.98rem;color:var(--muted);font-style:italic;font-weight:300}
.panel .big{font-size:clamp(3.2rem,6vw,5.4rem);margin:10px 0 30px}
.kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 26px;max-width:330px}
.kv .v{font-size:2rem}
.chart{position:absolute;right:-20px;bottom:96px;width:46%;height:200px}
.ghost{position:absolute;left:44px;bottom:26px;filter:blur(1.6px);opacity:.55}
.ghost b{font-weight:400;font-size:1.25rem;display:block}
.floating{position:absolute;left:-34px;bottom:34px;z-index:3;background:var(--surface-2);border:1px solid var(--line);border-radius:18px;padding:14px 18px;box-shadow:var(--shadow);font-size:.86rem;display:flex;gap:12px;align-items:center;transform:rotate(-3deg)}
.floating code{color:var(--ink-2)}

.clients{display:flex;flex-wrap:wrap;gap:12px 38px;align-items:center;justify-content:center;padding:30px 0 70px;color:var(--muted)}
.clients span{display:inline-flex;gap:10px;align-items:center}
.clients i{width:6px;height:6px;border-radius:50%;background:var(--faint);display:inline-block}

section.block{padding:90px 0;border-top:1px solid var(--line)}
.head{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:end;margin-bottom:54px}
.head h2{font-weight:200;font-size:clamp(2.2rem,4.4vw,3.6rem);line-height:1.02;letter-spacing:-.04em;margin:10px 0 0}
.head p{color:var(--ink-2);font-size:1.08rem;max-width:46ch;margin:0;justify-self:end}
.head p a{border-bottom:1px solid var(--line-2)}

.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:30px}
.step .n{font-size:4.4rem;color:var(--faint);display:block}
.step h3{font-weight:400;font-size:1.25rem;margin:18px 0 8px;letter-spacing:-.01em}
.step p{margin:0;color:var(--ink-2)}

.term{margin-top:18px;background:#0f1b27;color:#d7e3e8;border-radius:var(--radius);padding:26px 28px;font-family:var(--mono);font-size:.86rem;line-height:1.75;overflow-x:auto;border:1px solid #1d2d3c;box-shadow:var(--shadow)}
.term .dots{display:flex;gap:7px;margin-bottom:16px}.term .dots i{width:11px;height:11px;border-radius:50%;background:#2a3b4b;display:block}
.term .p,.term .dim{color:#6f8796}.term .ok{color:#7fd8b0}
.term pre{margin:0;font:inherit;white-space:pre}

.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);overflow:hidden}
.metrics div{padding:34px 30px;border-right:1px solid var(--line)}
.metrics div:last-child{border-right:0}
.metrics .num{font-size:3.6rem;display:block;margin-bottom:8px}

.features{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.feature h3{font-weight:400;font-size:1.15rem;margin:22px 0 8px}
.feature p{margin:0;color:var(--ink-2);font-size:.98rem}
.ico{width:44px;height:44px;border-radius:14px;border:1px solid var(--line-2);display:grid;place-items:center;background:var(--surface-2)}
.ico svg{width:20px;height:20px;stroke:var(--ink);fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}

.toggle{display:inline-flex;padding:5px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface-2);gap:4px;margin-bottom:34px}
.toggle label{cursor:pointer;padding:9px 20px;border-radius:999px;font-size:.92rem;color:var(--ink-2)}
.toggle label small{font-size:.75rem;color:var(--ok);margin-left:6px}
#bm:checked ~ .toggle label[for=bm],#by:checked ~ .toggle label[for=by]{background:var(--pill);color:var(--pill-ink)}
#by:checked ~ .toggle label[for=by] small{color:var(--pill-ink);opacity:.75}
#bm:focus-visible ~ .toggle label[for=bm],#by:focus-visible ~ .toggle label[for=by]{outline:2px solid var(--ink);outline-offset:2px}
.py{display:none}
#by:checked ~ .plans .pm{display:none}
#by:checked ~ .plans .py{display:inline}
.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.plan{display:flex;flex-direction:column;padding:34px 32px}
.plan.hot{background:var(--pill);color:var(--pill-ink);border-color:var(--pill)}
.plan.hot .muted,.plan.hot .eyebrow,.plan.hot li{color:color-mix(in srgb,var(--pill-ink) 72%,transparent)}
.plan .name{font-weight:400;font-size:1.2rem;display:flex;justify-content:space-between;align-items:center}
.plan .tag{font-size:.72rem;padding:4px 10px;border-radius:999px;border:1px solid currentColor;opacity:.8}
.plan .price{margin:26px 0 6px;display:flex;align-items:baseline;gap:8px}
.plan .price .num{font-size:4.4rem}
.plan ul{list-style:none;padding:0;margin:26px 0 30px;display:grid;gap:12px}
.plan li{display:flex;gap:12px;align-items:baseline;color:var(--ink-2)}
.plan li::before{content:"";flex:none;width:14px;height:1px;background:currentColor;opacity:.5;transform:translateY(-4px)}
.plan li b{font-weight:400}
.plan.hot li b{color:var(--pill-ink)}
.plan .btn{margin-top:auto;justify-content:center}
.plan.hot .btn{background:var(--pill-ink);color:var(--pill);border-color:var(--pill-ink)}
.fineprint{margin-top:22px;color:var(--muted);font-size:.88rem}

.tablewrap{overflow-x:auto;margin-top:40px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
table.compare{width:100%;min-width:560px;border-collapse:collapse;font-size:.96rem}
.compare th,.compare td{padding:16px 22px;text-align:left;border-bottom:1px solid var(--line)}
.compare th{font-weight:400;color:var(--muted);font-style:italic}
.compare td.num{font-size:1.2rem;font-weight:300;letter-spacing:-.01em}
.compare tr:last-child td{border-bottom:0}

.faq{display:grid;gap:12px;max-width:860px}
details{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:0 26px}
summary{cursor:pointer;list-style:none;padding:22px 0;font-weight:400;font-size:1.06rem;display:flex;justify-content:space-between;gap:20px}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";font-weight:200;font-size:1.6rem;line-height:1;color:var(--muted);transition:transform .2s}
details[open] summary::after{transform:rotate(45deg)}
details p{margin:0 0 22px;color:var(--ink-2)}

.closing{text-align:center;padding:110px 0 120px;border-top:1px solid var(--line)}
.closing h2{font-weight:200;font-size:clamp(2.6rem,6vw,5rem);letter-spacing:-.045em;line-height:1;margin:14px 0 30px}
.closing .cta{justify-content:center}

.prose{max-width:760px;padding:70px 0 90px}
.prose h1{font-weight:200;font-size:clamp(2.6rem,5vw,4rem);letter-spacing:-.04em;line-height:1;margin:8px 0 28px}
.prose h2{font-weight:400;font-size:1.3rem;margin:44px 0 10px;letter-spacing:-.01em}
.prose p,.prose li{color:var(--ink-2)}
.prose b{font-weight:400;color:var(--ink)}
.prose a{border-bottom:1px solid var(--line-2)}
.prose :not(pre) > code{background:var(--surface);border:1px solid var(--line);padding:2px 7px;border-radius:7px}

.dash{padding:60px 0 100px}
.dash-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}
.dash .card{padding:36px 40px}
.dash h1{font-weight:200;font-size:clamp(2.4rem,5vw,3.8rem);letter-spacing:-.04em;margin:8px 0 34px;line-height:1}
.dash h3{margin:0;font-weight:400;font-size:1.3rem}
.meter{height:56px;border-radius:14px;border:1px solid var(--line);overflow:hidden;position:relative;background:var(--surface-2);margin:26px 0 10px}
.meter span{position:absolute;inset:0 auto 0 0;background:repeating-linear-gradient(135deg,var(--hatch) 0 1.2px,transparent 1.2px 9px);border-right:1.5px solid var(--dot)}
.row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}

.center{min-height:78vh;display:grid;place-items:center;padding:60px 0}
.center .card{max-width:560px;padding:44px}
.center h1{font-weight:200;font-size:2.6rem;letter-spacing:-.035em;margin:6px 0 14px;line-height:1.05}

footer.foot{border-top:1px solid var(--line);padding:46px 0 60px;color:var(--muted);font-size:.9rem}
.foot .cols{display:flex;justify-content:space-between;gap:30px;flex-wrap:wrap}
.foot .brand{color:var(--ink)}
.foot nav{display:flex;gap:24px;flex-wrap:wrap}
.foot nav a:hover{color:var(--ink)}

@media (max-width:1180px){.hero{grid-template-columns:1fr 1fr}.chart{width:40%}}
@media (max-width:980px){
  .hero{grid-template-columns:1fr;padding-top:56px}
  .stage{min-height:480px;margin-top:10px}
  .panel{inset:0;transform:rotateX(10deg) rotateZ(3deg)}
  .head{grid-template-columns:1fr}.head p{justify-self:start}
  .steps,.features,.plans{grid-template-columns:1fr}
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
  .metrics div:nth-child(2){border-right:0}
  .metrics div:nth-child(-n+2){border-bottom:1px solid var(--line)}
  .dash-grid{grid-template-columns:1fr}
  .bar nav{display:none}
}
@media (max-width:560px){
  .wrap{width:calc(100% - 32px)}
  .panel{padding:28px 24px;border-radius:24px}
  .kv .v{font-size:1.8rem}
  .chart{display:none}
  .kv{max-width:none}
  .floating{left:8px;bottom:-12px}
  .metrics .num{font-size:2.6rem}
  .metrics div{padding:24px 20px}
  .dash .card,.center .card{padding:28px 24px}
  section.block{padding:64px 0}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const MARK = '<span class="mark" aria-hidden="true"><svg viewBox="0 0 512 512"><path d="M120 170l116 86-116 86" fill="none" stroke="var(--pill-ink)" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/><path d="M270 342h122" fill="none" stroke="var(--pill-ink)" stroke-width="48" stroke-linecap="round"/></svg></span>';

const HEADER = `<header class="top"><div class="wrap bar">
<a class="brand" href="/">${MARK}zSSH</a>
<nav aria-label="Main"><a href="/#how">How it works</a><a href="/#features">Security</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a></nav>
<span class="spacer"></span>
<a class="btn sm dark" href="/docs#install">Add the plugin <span class="arrow">→</span></a>
</div></header>`;

const FOOTER = `<footer class="foot"><div class="wrap cols">
<div><a class="brand" href="/">${MARK}zSSH</a><p>zSSH · your Linux servers, operated from ChatGPT and Claude.<br>Owner-controlled, outbound-only, revocable at any time.</p></div>
<nav aria-label="Footer"><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/Zennay/zSSH">GitHub</a></nav>
</div></footer>`;

function page(title, description, body, { bare = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#edf2f0">
<title>${esc(title)} · zSSH</title>
<style>${CSS}</style>
</head>
<body>
${HEADER}
<main>${body}</main>
${bare ? "" : FOOTER}
</body>
</html>`;
}

// Hatched area chart in the style of the reference: diagonal hairlines under
// a dotted series, dashed baselines, quiet date labels.
const CHART = `<svg class="chart" viewBox="0 0 360 220" aria-hidden="true">
<defs><pattern id="h" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="0" x2="0" y2="9" stroke="var(--hatch)" stroke-width="1.1"/></pattern></defs>
<path d="M0 168 L40 150 L78 160 L120 92 L160 110 L200 60 L240 78 L280 40 L320 70 L360 52 L360 190 L0 190 Z" fill="url(#h)"/>
<path d="M0 190 H360" stroke="var(--line-2)" stroke-dasharray="14 10" stroke-width="1.2"/>
<path d="M0 128 H360" stroke="var(--line)" stroke-dasharray="14 10" stroke-width="1"/>
<g fill="var(--dot)"><circle cx="40" cy="150" r="4"/><circle cx="120" cy="92" r="4"/><circle cx="200" cy="60" r="4.5"/><circle cx="280" cy="40" r="4.5"/><circle cx="356" cy="52" r="4"/></g>
<g fill="var(--faint)"><circle cx="78" cy="160" r="3.2"/><circle cx="160" cy="110" r="3.2"/><circle cx="240" cy="78" r="3.2"/><circle cx="320" cy="70" r="3.2"/></g>
<g fill="var(--muted)" font-size="13" font-style="italic"><text x="0" y="214">16 Sep</text><text x="150" y="214">17 Sep</text><text x="300" y="214">18 Sep</text></g>
</svg>`;

const ICONS = {
  out: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5"/></svg>',
  shell: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/></svg>',
  fleet: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>',
  cut: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 8.5l7 7"/></svg>',
  log: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/></svg>',
};

const PLAN_EXTRAS = {
  free: ["Status, files &amp; opt-in shell", "Community support"],
  pro: ["Address servers by name", "Email support"],
  team: ["Built for agencies &amp; fleets", "Priority support"],
};

function planCard(id, { hot = false, tag = "", cta, href }) {
  const x = PLANS[id];
  const monthly = x.price_eur.month;
  const perMonthYearly = String(Math.round((x.price_eur.year / 12) * 100) / 100).replace(".", ",");
  return `<article class="card plan${hot ? " hot" : ""}">
<div class="name">${esc(x.name)}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</div>
<p class="muted" style="margin:6px 0 0">${esc(x.blurb)}</p>
<div class="price"><span class="num">€<span class="pm">${monthly}</span><span class="py">${perMonthYearly}</span></span><span class="muted">/ month</span></div>
<div class="eyebrow">${monthly === 0 ? "Free forever, no card needed" : `<span class="pm">Billed monthly</span><span class="py">€${x.price_eur.year} billed yearly</span>`}</div>
<ul>
<li><span><b>${fmt(x.max_servers)}</b> linked server${x.max_servers === 1 ? "" : "s"}</span></li>
<li><span><b>${fmt(x.daily_actions)}</b> actions per day</span></li>
${PLAN_EXTRAS[id].map(t => `<li><span>${t}</span></li>`).join("")}
</ul>
<a class="btn${hot || id === "free" ? "" : " dark"}" href="${href}">${esc(cta)} <span class="arrow">→</span></a>
</article>`;
}

function pricingBlock() {
  return `<input class="sr" type="radio" name="billing" id="bm" checked aria-label="Monthly billing"><input class="sr" type="radio" name="billing" id="by" aria-label="Yearly billing">
<div class="toggle"><label for="bm">Monthly</label><label for="by">Yearly<small>2 months free</small></label></div>
<div class="plans">
${planCard("free", { cta: "Start free", href: "/docs#install" })}
${planCard("pro", { hot: true, tag: "Most popular", cta: "Upgrade to Pro", href: "/docs#upgrade" })}
${planCard("team", { cta: "Upgrade to Team", href: "/docs#upgrade" })}
</div>
<p class="fineprint">An action is one tool call: reading a file, checking disk usage, running a command. Limits reset daily at 00:00 UTC. Prices in EUR. Payments by Stripe (cards, iDEAL, SEPA). Cancel anytime.</p>`;
}

const FAQ = `<div class="faq">
<details><summary>Do I need to paste an MCP URL, SSH key or token?</summary><p>No. Install zSSH from the plugin marketplace in ChatGPT or Claude and sign in. The plugin gives you one command for your VPS; that is the whole setup.</p></details>
<details><summary>What does the install command do on my server?</summary><p>It creates an unprivileged <code>zssh</code> user, installs a small outbound-only agent with its own Ed25519 key, and links that key to your account with a one-use code that expires after 15 minutes. No inbound port is opened and nothing runs as root afterwards.</p></details>
<details><summary>Can the assistant run any command?</summary><p>Only if you allow it. Shell access is a per-server opt-in (<code>--allow-shell</code>), and even then commands run as the unprivileged <code>zssh</code> user. Without it, zSSH is limited to status checks and files inside the allowed roots.</p></details>
<details><summary>How do I disconnect a server?</summary><p>Ask the assistant to disconnect it, or stop the agent on the server. Revocation is immediate and the old key can never reconnect.</p></details>
<details><summary>What happens when I hit my daily limit?</summary><p>Tools politely refuse until 00:00 UTC and offer an upgrade link. Nothing on your server is affected.</p></details>
</div>`;

const HOME = page(
  "Your servers, in ChatGPT & Claude",
  "Link a Linux VPS to ChatGPT or Claude with one install command. Outbound-only agent, opt-in shell, revocable at any time.",
  `<div class="wrap">
<section class="hero">
<div>
<span class="chip"><span class="dotlive"></span>A plugin for ChatGPT &amp; Claude</span>
<h1>One command.<br>Your VPS, <em>linked.</em></h1>
<p class="lead">Add the zSSH plugin, run the command it gives you on your server, and let ChatGPT or Claude inspect, edit and operate it. Safely.</p>
<div class="cta"><a class="btn dark" href="/docs#install">Add the plugin <span class="arrow">→</span></a><a class="btn" href="/pricing">See pricing</a></div>
<p class="fine">Free for one server · No credit card · Any Linux VPS</p>
</div>
<div class="stage" aria-hidden="true">
<div class="panel">
<h3>web-1 · eu-west</h3>
<div class="k">In last 7 days</div>
<div class="k" style="margin-top:34px">Actions relayed: Day</div>
<div class="big num">18,320</div>
<div class="kv">
<div><div class="k">Avg. response</div><div class="v num">142ms</div></div>
<div><div class="k">Uptime</div><div class="v num">99.98%</div></div>
<div><div class="k">Disk free</div><div class="v num">61.4%</div></div>
<div><div class="k">Servers online</div><div class="v num">5/5</div></div>
</div>
${CHART}
<div class="ghost"><b>Load average</b><span class="k">In last 7 days</span></div>
</div>
<div class="floating"><span class="dotlive"></span><code>ZSSH_LINKED name=web-1</code></div>
</div>
</section>
<div class="clients" aria-label="Works with"><span><i></i>ChatGPT</span><span><i></i>Claude</span><span><i></i>Claude Code</span><span><i></i>Codex</span><span><i></i>Any Linux VPS</span></div>
</div>

<section class="block" id="how"><div class="wrap">
<div class="head"><div><span class="eyebrow">How it works</span><h2>From marketplace<br>to a working server in a minute.</h2></div><p>No SSH keys in a chat window, no MCP URLs, no firewall changes. The plugin carries the connection; your server dials out.</p></div>
<div class="steps">
<article class="card step"><span class="n num">01</span><h3>Add the plugin</h3><p>Find zSSH in the ChatGPT or Claude plugin marketplace and sign in once. One account covers all your servers.</p></article>
<article class="card step"><span class="n num">02</span><h3>Ask to link a server</h3><p>Say “link my server”. You get a personal, one-use install command that expires in 15 minutes.</p></article>
<article class="card step"><span class="n num">03</span><h3>Run it on your VPS</h3><p>Paste it as root. The agent installs, links itself and reports back. Then just ask: “how full is the disk on web-1?”</p></article>
</div>
<div class="term" aria-label="Example install"><div class="dots"><i></i><i></i><i></i></div><pre><span class="p">root@web-1:~#</span> curl -fsSL https://zssh.zennay.nl/install.sh | bash -s -- --enroll zse_•••••• --allow-shell
<span class="dim">→ creating unprivileged user zssh</span>
<span class="dim">→ installing outbound agent (Ed25519, no inbound ports)</span>
<span class="dim">ZSSH_TARGET_FINGERPRINT SHA256:3fV9…kQ0</span>
<span class="ok">ZSSH_LINKED name=web-1 — this server is now linked to your zSSH account.</span></pre></div>
</div></section>

<section class="block"><div class="wrap">
<div class="metrics">
<div><span class="num">0</span><span class="k">open inbound ports</span></div>
<div><span class="num">1</span><span class="k">command to link</span></div>
<div><span class="num">15m</span><span class="k">install code lifetime</span></div>
<div><span class="num">25k</span><span class="k">actions / day on Pro</span></div>
</div>
</div></section>

<section class="block" id="features"><div class="wrap">
<div class="head"><div><span class="eyebrow">Security model</span><h2>Powerful for the assistant.<br>Boring for attackers.</h2></div><p>Your Linux target stays yours. Every boundary stays on your side: you decide which server links, what it may do, and when it disconnects.</p></div>
<div class="features">
<article class="card feature"><span class="ico">${ICONS.out}</span><h3>Outbound-only agent</h3><p>The agent dials out to the gateway over TLS. Nothing listens on your server, so there is nothing to scan.</p></article>
<article class="card feature"><span class="ico">${ICONS.user}</span><h3>Unprivileged by design</h3><p>Runs as a dedicated <code>zssh</code> user, never root. Credential files and secret-like content are blocked.</p></article>
<article class="card feature"><span class="ico">${ICONS.shell}</span><h3>Shell is opt-in</h3><p>Status and file tools by default. Shell only when you install with <code>--allow-shell</code>; turn it off again any time.</p></article>
<article class="card feature"><span class="ico">${ICONS.fleet}</span><h3>Many servers, one account</h3><p>Name your servers and address them by name. “Restart nginx on api-2” just works.</p></article>
<article class="card feature"><span class="ico">${ICONS.cut}</span><h3>Revoke in one sentence</h3><p>Disconnect from the chat or stop the agent. A revoked key can never reconnect.</p></article>
<article class="card feature"><span class="ico">${ICONS.log}</span><h3>Audit stays local</h3><p>Every action is logged on your own server, with secrets redacted. We keep no conversation history.</p></article>
</div>
</div></section>

<section class="block" id="pricing"><div class="wrap">
<div class="head"><div><span class="eyebrow">Pricing</span><h2>Generous limits.<br>Honest prices.</h2></div><p>Start free on one server. Upgrade when your fleet grows. Every plan includes every security feature.</p></div>
${pricingBlock()}
</div></section>

<section class="block"><div class="wrap">
<div class="head"><div><span class="eyebrow">Questions</span><h2>Good to know.</h2></div><p>Still curious? The <a href="/docs">docs</a> cover every installer flag.</p></div>
${FAQ}
</div></section>

<section class="closing"><div class="wrap">
<span class="eyebrow">Ready when you are</span>
<h2>Give your assistant<br>a server to work on.</h2>
<div class="cta"><a class="btn dark" href="/docs#install">Add the plugin <span class="arrow">→</span></a><a class="btn" href="/pricing">Compare plans</a></div>
</div></section>`
);

function compareTable() {
  const row = (label, f) => `<tr><td>${label}</td>${["free", "pro", "team"].map(id => `<td class="num">${f(PLANS[id])}</td>`).join("")}</tr>`;
  return `<div class="tablewrap"><table class="compare">
<thead><tr><th>Included</th><th>Free</th><th>Pro</th><th>Team</th></tr></thead>
<tbody>
${row("Linked servers", x => fmt(x.max_servers))}
${row("Actions per day", x => fmt(x.daily_actions))}
${row("Price / month", x => "€" + x.price_eur.month)}
${row("Price / year", x => "€" + x.price_eur.year)}
${row("Opt-in shell access", () => "✓")}
${row("Outbound-only agent &amp; local audit", () => "✓")}
${row("Support", x => ({ free: "Community", pro: "Email", team: "Priority" })[x.id])}
</tbody></table></div>`;
}

const PRICING = page(
  "Pricing",
  "zSSH plans: Free for one server, Pro and Team for growing fleets. Generous daily action limits.",
  `<section class="block" style="border-top:0;padding-top:70px"><div class="wrap">
<div class="head"><div><span class="eyebrow">Pricing</span><h2>Pick a plan.<br>Change it any time.</h2></div><p>Upgrades start in the chat: ask zSSH for “my account” and you get a private link to checkout or the billing portal.</p></div>
${pricingBlock()}
${compareTable()}
</div></section>
<section class="block"><div class="wrap">
<div class="head"><div><span class="eyebrow">Billing</span><h2>Billing questions.</h2></div><p>Payments run on Stripe. We never see your card details.</p></div>
<div class="faq">
<details><summary>How do I upgrade?</summary><p>In ChatGPT or Claude, ask zSSH “show my zSSH account”. It replies with a personal link (valid for one hour) where you pick Pro or Team and pay via Stripe Checkout.</p></details>
<details><summary>Which payment methods are supported?</summary><p>Cards, iDEAL, SEPA Direct Debit, Apple Pay and Google Pay, depending on what Stripe offers in your country.</p></details>
<details><summary>Can I cancel?</summary><p>Yes, any time from the billing portal. You keep your plan until the end of the period, then fall back to Free. Servers beyond the Free limit stay linked, but you cannot add new ones.</p></details>
<details><summary>Why are actions limited at all?</summary><p>To keep the shared gateway fast and abuse-free. The limits are deliberately high: even Free covers hundreds of tool calls a day.</p></details>
</div>
</div></section>`
);

const DOCS = page(
  "Docs",
  "Install the zSSH plugin in ChatGPT or Claude and link a Linux server with one command.",
  `<div class="wrap prose">
<span class="eyebrow">Documentation</span>
<h1>Set up zSSH</h1>
<p>zSSH links your own Linux servers to ChatGPT and Claude. The plugin already contains the connection to the hosted gateway, so setup is: add the plugin, sign in, run one command.</p>
<h2 id="install">1 · Add the plugin</h2>
<ul>
<li><b>Claude Code:</b> <code>/plugin marketplace add Zennay/zSSH</code>, then <code>/plugin install zssh@zssh</code>.</li>
<li><b>Claude (web, desktop):</b> open the plugin directory, add the <code>Zennay/zSSH</code> marketplace and install <b>zSSH</b>.</li>
<li><b>ChatGPT:</b> open Apps &amp; plugins, search for <b>zSSH</b> and install it.</li>
</ul>
<p>Sign in when the plugin asks. One account covers all your servers.</p>
<h2>2 · Get your install command</h2>
<p>Ask “link my server” (or run <code>/zssh:setup</code> in Claude Code). You receive a personal command that works once and expires after 15 minutes. Do not share it.</p>
<h2>3 · Run it on your VPS</h2>
<div class="term"><div class="dots"><i></i><i></i><i></i></div><pre><span class="p">#</span> curl -fsSL https://zssh.zennay.nl/install.sh | bash -s -- --enroll &lt;code&gt; --gateway https://zssh.zennay.nl --ref &lt;sha&gt;
<span class="ok">ZSSH_LINKED name=web-1</span></pre></div>
<p>Optional flags:</p>
<ul>
<li><code>--name &lt;name&gt;</code>: the name shown in the chat (default: hostname).</li>
<li><code>--allow-shell</code>: let the assistant run shell commands as the unprivileged <code>zssh</code> user.</li>
<li><code>--no-shell</code>: turn shell access off again. Re-run the installer to switch.</li>
</ul>
<h2>4 · Use it</h2>
<p>Ask naturally: “how much disk is left on web-1?”, “show the last nginx errors”, “list my servers”. With several servers, mention the name; with one, zSSH picks it automatically.</p>
<h2 id="upgrade">Plans &amp; billing</h2>
<p>Ask “show my zSSH account”. You get your usage and a private link (valid for one hour) to upgrade or manage billing. See <a href="/pricing">pricing</a>.</p>
<h2>Disconnect</h2>
<p>Ask the assistant to disconnect a server, or stop the agent on the server. Revoked keys cannot reconnect.</p>
<h2>Self-hosted gateway</h2>
<p>The private, self-hosted MCP route still exists for operators who run their own gateway. See the <a href="https://github.com/Zennay/zSSH">repository README</a>.</p>
</div>`
);

const PRIVACY = page(
  "Privacy",
  "How zSSH handles authentication, target data, audit records, billing and secrets.",
  `<div class="wrap prose">
<span class="eyebrow">Legal</span>
<h1>Privacy</h1>
<p>zSSH minimizes the data needed to connect an authenticated user to an explicitly linked Linux target. This page describes the data handled by the public zSSH service and the owner-controlled target agent.</p>
<h2>Data categories</h2><ul><li>OAuth identity claims and scopes needed to authorize a request.</li><li>Pairing state, an opaque zSSH profile identifier, an opaque target identifier, the server name, and short-lived enrollment identifiers.</li><li>Tool inputs and bounded tool results needed to perform the operation the user requested.</li><li>A daily action counter per profile, kept in memory to enforce plan limits.</li><li>For paid plans: Stripe customer and subscription identifiers and plan status. Card details are handled by Stripe and never reach zSSH.</li><li>Target-local security audit events containing action type, outcome, bounded execution metadata, paths, and redacted command information.</li></ul>
<h2>Purpose</h2><p>zSSH uses this data only to authenticate and authorize the connection, route a request to the linked target, perform the requested operation, return the result, enforce security policy and plan limits, bill subscriptions, support revocation, and maintain the target owner's local security audit trail.</p>
<h2>Recipients</h2><p>Request data is exchanged between the user's MCP client, the configured zSSH public gateway, and the explicitly linked target agent as needed to complete the request. Stripe processes payment data for paid plans. zSSH does not require a separate zSSH-operated data warehouse for target file contents. ChatGPT or another MCP client provider processes data under its own terms and privacy policy, and the target owner controls the Linux host and its local records.</p>
<h2>Retention</h2><p>zSSH does not keep a separate conversation history. Pending enrollment codes expire automatically after the configured short TTL (15 minutes by default). Linked or revoked target records and target-local audit records remain on operator-controlled zSSH infrastructure until the target owner revokes, removes, rotates, or deletes that local state according to the owner's retention policy. Billing records are kept as long as accounting law requires. Tool results are returned to the calling client rather than stored as a separate zSSH conversation archive.</p>
<h2>User controls</h2><ul><li>The Linux target owner can approve or immediately revoke pairing, stop or uninstall the agent, and remove local pairing or audit state.</li><li>Shell access stays off unless the target owner installs with <code>--allow-shell</code>; the operator can restrict the public filesystem roots.</li><li>Users can cancel a subscription at any time in the Stripe billing portal.</li><li>Users can ask the target owner to revoke their zSSH profile's access to that target.</li></ul>
<h2>Secrets</h2><p>Do not use zSSH to retrieve or store passwords, private keys, bearer tokens, API keys, MFA/OTP codes, or other credentials. The public profile blocks common credential paths and secret-like file content. Access tokens are authentication material and are never intentionally returned as tool output.</p>
<h2>Target ownership</h2><p>Linking requires running the one-use install command on the target itself, and revocation remains controlled by the Linux target owner. OAuth authentication alone does not authorize a target.</p>
<p>For privacy or security questions, use the <a href="/support">support route</a>.</p>
</div>`
);

const TERMS = page(
  "Terms",
  "Usage conditions for the zSSH service and subscriptions.",
  `<div class="wrap prose">
<span class="eyebrow">Legal</span>
<h1>Terms</h1>
<p>Use zSSH only on Linux systems you own or are explicitly authorized to administer. You are responsible for the commands, files, and target permissions you intentionally expose, including whether you enable shell access.</p>
<p>The public profile is intentionally limited. It may refuse paths, content, or operations that create a credential-exposure or destructive-operation risk. Do not attempt to bypass those controls.</p>
<h2>Subscriptions</h2>
<p>Paid plans renew automatically each month or year until cancelled in the billing portal. Cancellation takes effect at the end of the current period. Plan limits (linked servers, daily actions) apply as listed on the <a href="/pricing">pricing page</a>.</p>
<h2>Availability</h2>
<p>Service availability is not guaranteed. Keep an independent recovery path for critical infrastructure.</p>
</div>`
);

const SUPPORT = page(
  "Support",
  "Support and troubleshooting guidance for zSSH.",
  `<div class="wrap prose">
<span class="eyebrow">Help</span>
<h1>Support</h1>
<p>Before reporting a problem, confirm that the plugin is signed in, the install command finished with <code>ZSSH_LINKED</code>, the server shows as online in “list my servers”, and the requested path is inside the allowed roots.</p>
<h2>Useful diagnostics</h2><ul><li><code>GET /health</code> should return a healthy zSSH service response.</li><li>The OAuth protected-resource document should be available at <code>/.well-known/oauth-protected-resource</code>.</li><li>Linking requires running the one-use install command on the target; the remote service cannot link a server by itself.</li></ul>
<h2>Contact support</h2>
<p>For installation questions, bug reports, compatibility issues, and feature requests, open a <a href="https://github.com/Zennay/zSSH/issues">GitHub support issue</a>. This is the public end-user support route for zSSH.</p>
<p>For security vulnerabilities, use the repository's <a href="https://github.com/Zennay/zSSH/security/advisories/new">private vulnerability-reporting flow</a>. Never post passwords, private keys, bearer tokens, API keys, MFA/OTP codes, capability URLs, or exploit details in a public issue.</p>
<p>Source history is maintained at <a href="https://github.com/Zennay/zSSH">github.com/Zennay/zSSH</a>.</p>
</div>`
);

const WELCOME = page(
  "Welcome aboard",
  "Your zSSH subscription is active.",
  `<div class="wrap center"><div class="card">
<span class="eyebrow">Payment received</span>
<h1>Welcome aboard.</h1>
<p class="muted">Your new limits apply as soon as Stripe confirms the subscription, usually within seconds. Head back to ChatGPT or Claude and ask “show my zSSH account” to see them.</p>
<div class="actions"><a class="btn dark" href="/docs">Read the docs <span class="arrow">→</span></a><a class="btn" href="/">Home</a></div>
</div></div>`,
  { bare: true }
);

const PAGES = new Map([
  ["/", HOME],
  ["/pricing", PRICING],
  ["/docs", DOCS],
  ["/privacy", PRIVACY],
  ["/terms", TERMS],
  ["/support", SUPPORT],
  ["/account/welcome", WELCOME],
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

export function messagePageResponse(status, title, text) {
  const body = page(title, text, `<div class="wrap center"><div class="card">
<span class="eyebrow">zSSH</span>
<h1>${esc(title)}</h1>
<p class="muted">${esc(text)}</p>
<div class="actions"><a class="btn" href="/">Home</a><a class="btn" href="/support">Support</a></div>
</div></div>`, { bare: true });
  return { status, headers: { ...PRIVATE_HEADERS }, body };
}

// Personal account dashboard reached through the plugin's signed link.
export function accountPageResponse({ plan, entitlement, servers, actionsToday, resetsAt, token, canManage }) {
  const t = encodeURIComponent(token);
  const limit = plan.daily_actions;
  const pct = Number.isFinite(limit) && limit > 0 ? Math.min(100, (actionsToday / limit) * 100) : 0;
  const serverPct = Number.isFinite(plan.max_servers) && plan.max_servers > 0 ? Math.min(100, (servers / plan.max_servers) * 100) : 0;
  const resets = new Date(resetsAt);
  const resetLabel = Number.isNaN(resets.getTime()) ? "daily" : "at " + resets.toISOString().slice(11, 16) + " UTC";
  const renews = entitlement.current_period_end ? new Date(entitlement.current_period_end) : null;
  const status = entitlement.status && entitlement.status !== "none" ? entitlement.status.replace(/_/g, " ") : "free";
  const targets = { free: ["pro", "team"], pro: ["team"], team: [] }[plan.id] || [];
  const upgrades = targets.map(id => {
    const x = PLANS[id];
    return `<a class="btn dark" href="/checkout?plan=${id}&amp;interval=month&amp;t=${t}">${esc(x.name)} · €${x.price_eur.month}/mo <span class="arrow">→</span></a>` +
      `<a class="btn" href="/checkout?plan=${id}&amp;interval=year&amp;t=${t}">${esc(x.name)} yearly · €${x.price_eur.year}</a>`;
  }).join("");
  const body = page("Your account", "Your zSSH plan and usage.", `<div class="wrap dash">
<span class="eyebrow">Your account · private link, valid for one hour</span>
<h1>${esc(plan.name)} plan</h1>
<div class="dash-grid">
<section class="card">
<div class="row"><div><h3>Actions</h3><div class="eyebrow">Today, resets ${esc(resetLabel)}</div></div><span class="chip"><span class="dotlive"></span>${esc(status)}</span></div>
<div class="eyebrow" style="margin-top:34px">Used today</div>
<div class="num" style="font-size:clamp(3.4rem,8vw,6rem);margin-top:8px">${fmt(actionsToday)}</div>
<div class="meter" role="img" aria-label="${Math.round(pct)}% of daily actions used"><span style="width:${pct.toFixed(1)}%"></span></div>
<div class="row muted"><span>0</span><span>${fmt(limit)} / day</span></div>
</section>
<section class="card">
<h3>Servers</h3><div class="eyebrow">Linked to this account</div>
<div class="num" style="font-size:4.6rem;margin:34px 0 0">${fmt(servers)}<span class="muted" style="font-size:2rem"> / ${fmt(plan.max_servers)}</span></div>
<div class="meter" role="img" aria-label="${Math.round(serverPct)}% of server slots used"><span style="width:${serverPct.toFixed(1)}%"></span></div>
<div class="eyebrow">${renews && !Number.isNaN(renews.getTime()) ? "Current period ends " + esc(renews.toISOString().slice(0, 10)) : "No renewal scheduled"}</div>
</section>
</div>
<div class="actions">${upgrades}${canManage ? `<a class="btn" href="/billing/portal?t=${t}">Manage billing <span class="arrow">→</span></a>` : ""}</div>
<p class="fineprint">This page is personal. Don't share its link; ask zSSH for a fresh one any time.</p>
</div>`, { bare: true });
  return { status: 200, headers: { ...PRIVATE_HEADERS }, body };
}
