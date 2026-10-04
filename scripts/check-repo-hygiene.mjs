import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowDir = join(root, ".github", "workflows");

const forbiddenNames = [
  {
    pattern: /^(?:ftmo|zcloud|haxlab|raiseai)[-_].*\.ya?ml$/i,
    reason: "cross-project portfolio workflows must not live in the zSSH release repository",
  },
];

const forbiddenContent = [
  {
    pattern: /\b(?:repos\/Zennay\/|github\.com\/Zennay\/)(?:Ftmo|zCloud|HaxLab|RaiseAI)\b/i,
    reason: "workflow content must not operate another portfolio repository",
  },
  {
    pattern: /\b(?:FTMO|HAXLAB|RAISEAI)_[A-Z0-9_]+\b/,
    reason: "workflow content contains another project's operational environment contract",
  },
  {
    pattern: /\bcontents\s*:\s*write\b/i,
    reason: "zSSH release workflows must not receive repository contents write permission",
  },
  {
    pattern: /\bgit\s+push\b/i,
    reason: "zSSH release workflows must not mutate canonical repository history",
  },
  {
    pattern: /\bself-hosted\b/i,
    reason: "VPS/self-hosted execution belongs to the zCloud control-plane repository, not the zSSH release repository",
  },
];

const names = readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name));
const violations = [];

for (const name of names) {
  for (const rule of forbiddenNames) {
    if (rule.pattern.test(name)) {
      violations.push({ name, reason: rule.reason });
      break;
    }
  }

  const workflow = readFileSync(join(workflowDir, name), "utf8");
  for (const rule of forbiddenContent) {
    if (rule.pattern.test(workflow)) {
      violations.push({ name, reason: rule.reason });
    }
  }
}

if (violations.length > 0) {
  console.error("ZSSH_REPO_HYGIENE_FAILED");
  for (const violation of violations) {
    console.error(`- ${violation.name}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log("ZSSH_REPO_HYGIENE_GREEN", names.length);
