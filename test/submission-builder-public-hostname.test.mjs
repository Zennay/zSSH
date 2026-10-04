import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(".");

async function expectBuilderFailure(mcpUrl, demoUrl) {
  await assert.rejects(
    () => execFileAsync(
      "python3",
      [
        "scripts/build-openai-plugin.py",
        "--mcp-url", mcpUrl,
        "--demo-url", demoUrl,
      ],
      { cwd: ROOT },
    ),
    error => /public DNS hostname reachable by OpenAI reviewers/.test(
      String(error?.stderr || error?.message || ""),
    ),
  );
}

test("submission builder rejects non-public MCP hostnames", async () => {
  await expectBuilderFailure(
    "https://127.0.0.1/mcp",
    "https://zssh.cheapgpt.shop/review/zssh-demo",
  );
  await expectBuilderFailure(
    "https://mcp.review.example/mcp",
    "https://zssh.cheapgpt.shop/review/zssh-demo",
  );
});

test("submission builder rejects non-public demo hostnames", async () => {
  await expectBuilderFailure(
    "https://zssh.cheapgpt.shop/mcp",
    "https://localhost/zssh-demo",
  );
});
