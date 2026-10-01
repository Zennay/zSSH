import { readFileSync } from "node:fs";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function parsePackageVersion(raw) {
  let metadata;
  try {
    metadata = JSON.parse(String(raw));
  } catch {
    throw new Error("package.json must contain valid JSON");
  }
  const version = String(metadata?.version || "").trim();
  if (!SEMVER.test(version)) throw new Error("package.json requires a valid semantic version");
  return version;
}

export const VERSION = parsePackageVersion(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
