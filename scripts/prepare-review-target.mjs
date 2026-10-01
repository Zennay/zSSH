#!/usr/bin/env node
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const rootValue = rootIndex >= 0 ? args[rootIndex + 1] : process.env.ZSSH_REVIEW_ROOT;
if (!rootValue) {
  throw new Error("Set ZSSH_REVIEW_ROOT or pass --root. For OpenAI review use /srv/zssh-review.");
}

const root = path.resolve(rootValue);
if (!path.isAbsolute(root)) throw new Error("review root must be absolute");

await mkdir(root, { recursive: true, mode: 0o700 });
const sample = path.join(root, "sample.txt");
const sampleContent = [
  "zSSH reviewer fixture",
  "status=ready",
  "purpose=OpenAI plugin read-file review case",
  "",
].join("\n");
await writeFile(sample, sampleContent, { encoding: "utf8", mode: 0o600 });

const info = await stat(sample);
console.log(JSON.stringify({
  ok: true,
  review_root: root,
  sample_file: sample,
  sample_bytes: info.size,
  allowed_roots_value: root,
  write_test_file: path.join(root, "output.txt"),
}, null, 2));
