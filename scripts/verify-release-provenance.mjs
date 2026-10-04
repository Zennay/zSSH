import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`release provenance verification failed: ${message}`);
}

const [sourceRoot, repoSha, releaseDir, ...options] = process.argv.slice(2);
if (!sourceRoot || !repoSha || !releaseDir) {
  fail("usage: <source-root> <40-char-commit-sha> <release-dir> [--allow-node-modules]");
}
const allowNodeModules = options.length === 1 && options[0] === "--allow-node-modules";
if (options.length > 0 && !allowNodeModules) {
  fail("only --allow-node-modules is supported as an optional argument");
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
const expectedFiles = new Set();
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

  expectedFiles.add(relativePath);
  let parent = path.posix.dirname(relativePath);
  while (parent !== ".") {
    expectedDirectories.add(parent);
    parent = path.posix.dirname(parent);
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

if (
  allowNodeModules &&
  (
    expectedDirectories.has("node_modules") ||
    [...expectedFiles].some(relativePath =>
      relativePath === "node_modules" || relativePath.startsWith("node_modules/")
    )
  )
) {
  fail("cannot allow runtime node_modules when the commit tracks node_modules");
}

function verifyNoUnexpectedEntries(directory, relativeDirectory = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (allowNodeModules && relativePath === "node_modules") {
        continue;
      }
      if (!expectedDirectories.has(relativePath)) {
        fail(`unexpected release path: ${relativePath}`);
      }
      verifyNoUnexpectedEntries(absolutePath, relativePath);
      continue;
    }

    if (!expectedFiles.has(relativePath)) {
      fail(`unexpected release path: ${relativePath}`);
    }
  }
}

verifyNoUnexpectedEntries(releaseRoot);

process.stdout.write(JSON.stringify({
  ok: true,
  sha: repoSha,
  tracked_files_verified: checked,
}) + "\n");
