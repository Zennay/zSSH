import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const GATE_RUNBOOKS = Object.freeze({
  dns_publication: {
    label: "Cloudflare production DNS publication",
    path: "docs/research/cloudflare-dns-publication-2026-10-04.md",
  },
});

function fail(message) {
  throw new Error(message);
}

function gateRunbookLine({ gate, repository, sha }) {
  const runbook = GATE_RUNBOOKS[gate];
  if (!runbook) return null;
  const repo = String(repository || "Zennay/zSSH").trim();
  const [owner, name, ...extra] = repo.split("/");
  if (!owner || !name || extra.length > 0 || /\\s/.test(repo)) fail("repository must be owner/name");
  return `[${runbook.label}](https://github.com/${repo}/blob/${sha}/${runbook.path})`;
}

function cleanText(value, maxLength = 600) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validateReadiness(readiness) {
  if (!readiness || typeof readiness !== "object") fail("readiness receipt is required");
  if (readiness.phase !== "M5") fail("readiness receipt must describe M5");
  if (!Number.isInteger(readiness.schema_version) || readiness.schema_version < 4) {
    fail("readiness receipt schema v4 or newer is required");
  }
  const gate = readiness.blocking_gate;
  const action = readiness.blocking_action;
  if (gate == null) {
    if (action != null) fail("blocking_action must be null when blocking_gate is null");
    return;
  }
  if (!/^[a-z0-9_]+$/.test(String(gate))) fail("blocking_gate has an invalid format");
  if (!action || action.lane !== gate) fail("blocking_action must match blocking_gate");
}

function bulletNames(values) {
  const names = Array.isArray(values)
    ? values.map(value => cleanText(value, 120)).filter(Boolean)
    : [];
  return names.length > 0 ? names.map(name => `- \`${name}\``).join("\n") : "- none";
}

function invalidSummary(values) {
  const issues = Array.isArray(values) ? values : [];
  if (issues.length === 0) return "- none";
  return issues.map(issue => {
    const name = cleanText(issue?.name, 120) || "unknown";
    const reason = cleanText(issue?.reason, 300) || "invalid";
    return `- \`${name}\`: ${reason}`;
  }).join("\n");
}

export function renderM5BlockingIssue({ readiness, canonicalSha, repository = "Zennay/zSSH" }) {
  validateReadiness(readiness);
  const sha = String(canonicalSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) fail("canonicalSha must be a 40-character Git SHA");

  const gate = readiness.blocking_gate;
  const action = readiness.blocking_action;
  const executionState = cleanText(readiness.execution_state, 120) || "unknown";
  const laterGates = (Array.isArray(readiness.next_actions) ? readiness.next_actions : [])
    .map(item => cleanText(item?.lane, 120))
    .filter(Boolean)
    .filter(lane => lane !== gate);

  if (!gate) {
    return {
      title: "M5 release handoff: readiness gates green",
      body: [
        "<!-- zssh-managed-m5-handoff -->",
        "# zSSH M5 release handoff",
        "",
        `- Canonical main: \`${sha}\``,
        `- Execution state: \`${executionState}\``,
        "- Blocking gate: none",
        "",
        "All machine-readable M5 readiness gates are green. Continue only with the final submission/portal operation required by the release handbook.",
        "",
        "## Safety",
        "This issue is maintained automatically from the secret-safe protected readiness receipt. Never paste credential values into this issue.",
      ].join("\n"),
    };
  }

  const actionText = cleanText(action?.action, 800) || "Resolve the active M5 blocking gate.";
  const gateKind = cleanText(action?.gate_kind, 120) || "unknown";
  const external = action?.requires_external_input === true;
  const runbookLine = gateRunbookLine({ gate, repository, sha });

  return {
    title: `M5 active gate: ${gate}`,
    body: [
      "<!-- zssh-managed-m5-handoff -->",
      "# zSSH M5 active blocking gate",
      "",
      `- Canonical main: \`${sha}\``,
      `- Execution state: \`${executionState}\``,
      `- Blocking gate: \`${gate}\``,
      `- Gate kind: \`${gateKind}\``,
      `- Requires external input: ${external ? "yes" : "no"}`,
      "",
      "## Required action",
      actionText,
      "",
      ...(runbookLine ? ["## Canonical runbook", runbookLine, ""] : []),
      "## Missing configuration",
      bulletNames(action?.missing),
      "",
      "## Invalid configuration",
      invalidSummary(action?.invalid),
      "",
      "## Later gates",
      laterGates.length > 0 ? laterGates.map(name => `- \`${name}\``).join("\n") : "- none",
      "",
      "## Safety",
      "This issue is maintained automatically from the secret-safe protected readiness receipt. It records field names and validation reasons only. Never paste credential values into this issue, commits, artifacts, or Notion.",
    ].join("\n"),
  };
}

export async function syncM5BlockingIssue({
  repository,
  issueNumber,
  token,
  readiness,
  canonicalSha,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) fail("repository must be owner/name");
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) fail("issueNumber must be a positive integer");
  const authToken = String(token || "").trim();
  if (!authToken) fail("GITHUB_TOKEN is required");

  const rendered = renderM5BlockingIssue({ readiness, canonicalSha, repository });
  const response = await fetchImpl(
    `${apiUrl.replace(/\/$/, "")}/repos/${repository}/issues/${number}`,
    {
      method: "PATCH",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
        "user-agent": "zssh-m5-blocking-issue-sync",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify(rendered),
    },
  );

  if (!response.ok) {
    fail(`GitHub issue sync failed with HTTP ${response.status}`);
  }

  return {
    ok: true,
    issue_number: number,
    blocking_gate: readiness.blocking_gate,
    canonical_sha: String(canonicalSha).toLowerCase(),
    title: rendered.title,
  };
}

async function main() {
  const readinessPath = process.argv[2];
  if (!readinessPath) fail("readiness receipt path is required");
  const readiness = JSON.parse(readFileSync(readinessPath, "utf8"));
  const result = await syncM5BlockingIssue({
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.ZSSH_M5_BLOCKING_ISSUE || "159",
    token: process.env.GITHUB_TOKEN,
    readiness,
    canonicalSha: process.env.GITHUB_SHA,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  console.log("ZSSH_M5_BLOCKING_ISSUE_SYNCED", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("ZSSH_M5_BLOCKING_ISSUE_SYNC_FAILED", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
