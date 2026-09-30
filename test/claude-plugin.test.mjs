import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packagePlugin, validateMcpUrl } from "../scripts/package-claude.mjs";

function entries(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const length = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    files[name] = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length).toString();
    offset += 30 + nameLength + length;
  }
  return files;
}

test("plugin archive has portable layout and a fixed HTTPS endpoint with no secrets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zssh-plugin-"));
  try {
    const output = await packagePlugin({ url: "https://my-vps.example/mcp", output: path.join(dir, "plugin.zip") });
    const files = entries(await readFile(output));
    assert.deepEqual(Object.keys(files).sort(), [".claude-plugin/plugin.json", ".mcp.json", "README.md", "skills/vps/SKILL.md"]);
    const manifest = JSON.parse(files[".claude-plugin/plugin.json"]);
    assert.equal(manifest.name, "zssh");
    assert.equal(manifest.userConfig, undefined);
    assert.deepEqual(JSON.parse(files[".mcp.json"]).mcpServers.zssh, { type: "http", url: "https://my-vps.example/mcp" });
    assert.ok(!Object.values(files).join("").includes("Authorization: Bearer"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("packager rejects token-bearing URLs and insecure endpoints", () => {
  for (const url of ["http://vps.example/mcp", "https://u:secret@vps.example/mcp", "https://vps.example/mcp?token=secret", "https://vps.example/mcp#secret", "https://vps.example/"]) assert.throws(() => validateMcpUrl(url));
});
