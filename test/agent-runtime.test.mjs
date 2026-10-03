import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("target agent always uses narrow public roots and public tool surface", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-public-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "zssh-agent-private-"));
  const previous = {
    publicRoots: process.env.ZSSH_PUBLIC_ALLOWED_ROOTS,
    privateRoots: process.env.ZSSH_ALLOWED_ROOTS,
    audit: process.env.ZSSH_AUDIT_LOG,
  };

  try {
    process.env.ZSSH_PUBLIC_ALLOWED_ROOTS = root;
    process.env.ZSSH_ALLOWED_ROOTS = outside;
    process.env.ZSSH_AUDIT_LOG = path.join(root, "audit.jsonl");

    const { executeAgentCommand } = await import("../agent-runtime.mjs");

    const targetFile = path.join(root, "sample.txt");
    const written = await executeAgentCommand({
      tool: "zssh_write_file",
      args: { path: targetFile, content: "status=ready\n" },
    });
    assert.equal(written.ok, true);

    const read = await executeAgentCommand({
      tool: "zssh_read_file",
      args: { path: targetFile },
    });
    assert.equal(read.ok, true);
    assert.equal(read.content, "status=ready\n");

    const outsideFile = path.join(outside, "private.txt");
    await writeFile(outsideFile, "ordinary text\n");
    await assert.rejects(
      executeAgentCommand({ tool: "zssh_read_file", args: { path: outsideFile } }),
      /outside allowed roots/,
    );

    await assert.rejects(
      executeAgentCommand({
        tool: "zssh_write_file",
        args: { path: path.join(root, "credential.txt"), content: "token=supersecretvalue" },
      }),
      /secret|credential/i,
    );

    await assert.rejects(
      executeAgentCommand({ tool: "zssh_exec", args: { command: "id" } }),
      /not exposed/,
    );

    process.env.ZSSH_PUBLIC_ALLOWED_ROOTS = "";
    await assert.rejects(
      executeAgentCommand({ tool: "zssh_read_file", args: { path: targetFile } }),
      /no valid ZSSH_ALLOWED_ROOTS configured/,
    );
  } finally {
    if (previous.publicRoots === undefined) delete process.env.ZSSH_PUBLIC_ALLOWED_ROOTS;
    else process.env.ZSSH_PUBLIC_ALLOWED_ROOTS = previous.publicRoots;
    if (previous.privateRoots === undefined) delete process.env.ZSSH_ALLOWED_ROOTS;
    else process.env.ZSSH_ALLOWED_ROOTS = previous.privateRoots;
    if (previous.audit === undefined) delete process.env.ZSSH_AUDIT_LOG;
    else process.env.ZSSH_AUDIT_LOG = previous.audit;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
