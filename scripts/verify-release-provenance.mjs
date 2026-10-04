import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`release provenance verification failed: ${message}`);
}

const [sourceRoot, repoSha, releaseDir] = process.argv.slice(2);
if (!sourceRoot || !repoSha || !releaseDir) {
  fail("usage: <source-root> <40-char-commit-sha> <release-dir>");
}
if (!/^[0-9a-f]{40}$/.test(repoSha)) {
  fail("commit SHA must be a full 40-character lowercase hex SHA");
}

const releaseRoot = path.resolve(releaseDir);
const tree = execFileSync(
  "git",
  ["-C", sourceRoot, "ls-tree", "-r", "-z", "--full-tree", repoSha],
  { maxBuffer: 64 * 1024 * 1024 },
);

const records = tree.toString("utf8").split("\0").filter(Boolean);
const expectedPaths = new Set();
const expectedDirectories = new Set();
let checked = 0;

for (const record of records) {
  const tab = record.indexOf("\t");
  if (tab <= 0) fail("unexpected git ls-tree record");

  const header = record.slice(0, tab).split(" ");
  const relativePath = record.slice(tab + 1);
  const [mode, type, objectId] = header;

  if (type !== "blob") {
    fail(`unsupported tracked object type ${type} at ${relativePath}`);
  }
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.split("/").some(part => part === "..")
  ) {
    fail(`unsafe tracked path ${JSON.stringify(relativePath)}`);
  }

  expectedPaths.add(relativePath);
  const parts = relativePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    expectedDirectories.add(parts.slice(0, index).join("/"));
  }

  const destination = path.resolve(releaseRoot, relativePath);
  if (destination !== releaseRoot && !destination.startsWith(releaseRoot + path.sep)) {
    fail(`tracked path escapes release root: ${relativePath}`);
  }

  let stat;
  try {
    stat = lstatSync(destination);
  } catch {
    fail(`missing tracked path ${relativePath}`);
  }

  const blob = execFileSync(
    "git",
    ["-C", sourceRoot, "cat-file", "blob", objectId],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  if (mode === "120000") {
    if (!stat.isSymbolicLink()) {
      fail(`tracked symlink became a different file type: ${relativePath}`);
    }
    const target = Buffer.from(readlinkSync(destination));
    if (!target.equals(blob)) {
      fail(`tracked symlink target drifted: ${relativePath}`);
    }
  } else {
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`tracked regular file became a different file type: ${relativePath}`);
    }
    const actual = readFileSync(destination);
    if (!actual.equals(blob)) {
      fail(`tracked file content drifted: ${relativePath}`);
    }

    const expectedExecutable = mode === "100755";
    const actualExecutable = (stat.mode & 0o111) !== 0;
    if (expectedExecutable !== actualExecutable) {
      fail(`tracked executable mode drifted: ${relativePath}`);
    }
  }

  checked += 1;
}

if (checked === 0) fail("commit tree contains no tracked blobs");

function verifyNoUnexpectedEntries(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const destination = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!expectedDirectories.has(relativePath)) {
        fail(`unexpected untracked path ${relativePath}`);
      }
      verifyNoUnexpectedEntries(destination, relativePath);
      continue;
    }

    if (!expectedPaths.has(relativePath)) {
      fail(`unexpected untracked path ${relativePath}`);
    }
  }
}

verifyNoUnexpectedEntries(releaseRoot);

process.stdout.write(JSON.stringify({
  ok: true,
  sha: repoSha,
  tracked_files_verified: checked,
}) + "\n");
