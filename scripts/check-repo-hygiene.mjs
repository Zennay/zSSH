import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowDir = join(root, ".github", "workflows");

const forbidden = [
  {
    pattern: /^(?:ftmo|zcloud|haxlab|raiseai)[-_].*\.ya?ml$/i,
    reason: "cross-project portfolio workflows must not live in the zSSH release repository",
  },
];

const names = readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name));
const violations = [];

for (const name of names) {
  for (const rule of forbidden) {
    if (rule.pattern.test(name)) {
      violations.push({ name, reason: rule.reason });
      break;
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
