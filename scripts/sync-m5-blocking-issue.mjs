import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const GATE_RUNBOOKS = Object.freeze({
  dns_publication: {
    label: "Cloudflare production DNS publication",
    path: "docs/research/cloudflare-dns-publication-2026-10-04.md",
  },
  public_ingress: {
    label: "Public gateway and Caddy ingress rollout",
    path: "docs/research/public-caddy-promotion-2026-10-04.md",
  },
  auth0_preflight: {
    label: "Auth0 production OAuth qualification",
    path: "docs/research/auth0-production-oauth-2026-10-04.md",
  },
  reviewer_fixture: {
    label: "OpenAI reviewer fixture",
    path: "docs/openai-plugin-review.md",
  },
  portal_and_host_attestations: {
    label: "OpenAI portal and host validation",
    path: "docs/openai-plugin-release-checklist.md",
  },
  final_production_probe: {
    label: "Protected production submission probe",
    path: "docs/openai-plugin-release-checklist.md",
  },
});

const READINESS_SCHEMA_VERSION = 5;

const M5_GATE_ORDER = Object.freeze([
  "repository_governance",
  "dns_publication",
  "public_ingress",
  "auth0_preflight",
  "reviewer_fixture",
  "portal_and_host_attestations",
  "final_production_probe",
]);

function fail(message) {
  throw new Error(message);
}

function gateRunbookLine({ gate, repository, sha }) {
  const runbook = GATE_RUNBOOKS[gate];
  if (!runbook) return null;
  const repo = String(repository || "Zennay/zSSH").trim();
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\\s/.test(repo)) {
    fail("repository must be owner/name");
  }
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
  if (readiness.schema_version !== READINESS_SCHEMA_VERSION) {
    const observed = Number.isInteger(readiness.schema_version)
      ? `v${readiness.schema_version}`
      : "missing or invalid";
    fail(
      `readiness receipt schema v${READINESS_SCHEMA_VERSION} is required; received ${observed}`,
    );
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

export function renderM5BlockingIssue({ readiness, canonicalSha, repository = "Zennay/zSSH", workflowRunId = "" }) {
  validateReadiness(readiness);
  const sha = String(canonicalSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) fail("canonicalSha must be a 40-character Git SHA");
  const repo = String(repository || "Zennay/zSSH").trim();
  const repoParts = repo.split("/");
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1] || /\s/.test(repo)) {
    fail("repository must be owner/name");
  }
  const runId = String(workflowRunId || "").trim();
  if (runId && !/^[1-9]\d*$/.test(runId)) {
    fail("workflowRunId must be a positive GitHub Actions run ID");
  }
  const readinessRunLine = runId
    ? `- Readiness run: [\`${runId}\`](https://github.com/${repo}/actions/runs/${runId})`
    : null;

  const gate = readiness.blocking_gate;
  const action = readiness.blocking_action;
  const executionState = cleanText(readiness.execution_state, 120) || "unknown";
  const nextActionLanes = (Array.isArray(readiness.next_actions) ? readiness.next_actions : [])
    .map(item => cleanText(item?.lane, 120))
    .filter(Boolean)
    .filter(lane => lane !== gate);
  const gateIndex = M5_GATE_ORDER.indexOf(gate);
  const unresolvedFutureLanes = gateIndex >= 0
    ? M5_GATE_ORDER
      .slice(gateIndex + 1)
      .filter(name => readiness.ready?.[name] === false)
    : [];
  const laterGateNames = [...new Set([
    ...unresolvedFutureLanes,
    ...nextActionLanes,
    ...(gate ? ["final_production_probe"] : []),
  ])]
    .sort((left, right) => {
      const leftIndex = M5_GATE_ORDER.indexOf(left);
      const rightIndex = M5_GATE_ORDER.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  const laterGates = laterGateNames.map(name => ({
    name,
    runbook: gateRunbookLine({ gate: name, repository: repo, sha }),
  }));

  if (!gate) {
    const finalRunbookLine = gateRunbookLine({
      gate: "portal_and_host_attestations",
      repository: repo,
      sha,
    });
    return {
      title: "M5 release handoff: readiness gates green",
      body: [
        "<!-- zssh-managed-m5-handoff -->",
        "# zSSH M5 release handoff",
        "",
        `- Canonical main: \`${sha}\``,
        ...(readinessRunLine ? [readinessRunLine] : []),
        `- Execution state: \`${executionState}\``,
        "- Blocking gate: none",
        "",
        "All machine-readable M5 readiness gates are green. Do not submit in the portal yet: first dispatch the protected OpenAI public release gate on this exact canonical main revision and require OPENAI_PUBLIC_RELEASE_GATE_GREEN plus its release-evidence artifact.",
        "",
        "## Next internal release action",
        "Run the protected production submission probe on exact canonical main. Only after that succeeds should the portal submission be performed.",
        "",
        "## Canonical final-submission checklist",
        finalRunbookLine,
        "",
        "## Safety",
        "This issue is maintained automatically from the secret-safe protected readiness receipt. Never paste credential values into this issue.",
      ].join("\n"),
    };
  }

  const actionText = cleanText(action?.action, 800) || "Resolve the active M5 blocking gate.";
  const gateKind = cleanText(action?.gate_kind, 120) || "unknown";
  const external = action?.requires_external_input === true;
  const runbookLine = gateRunbookLine({ gate, repository: repo, sha });

  return {
    title: `M5 active gate: ${gate}`,
    body: [
      "<!-- zssh-managed-m5-handoff -->",
      "# zSSH M5 active blocking gate",
      "",
      `- Canonical main: \`${sha}\``,
      ...(readinessRunLine ? [readinessRunLine] : []),
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
      laterGates.length > 0
        ? laterGates.map(({ name, runbook }) => (
          runbook ? `- \`${name}\` — ${runbook}` : `- \`${name}\``
        )).join("\n")
        : "- none",
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
  workflowRunId = "",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(String(repository || ""))) fail("repository must be owner/name");
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) fail("issueNumber must be a positive integer");
  const authToken = String(token || "").trim();
  if (!authToken) fail("GITHUB_TOKEN is required");

  const rendered = renderM5BlockingIssue({ readiness, canonicalSha, repository, workflowRunId });
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
    workflow_run_id: String(workflowRunId || "").trim() || null,
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
    workflowRunId: process.env.GITHUB_RUN_ID,
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
