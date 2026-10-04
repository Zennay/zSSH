import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_PATH = new URL("./docs/openai-annotation-justifications.md", import.meta.url);
const KEYS = ["readOnlyHint", "destructiveHint", "openWorldHint"];

function fail(message) {
  throw new Error("annotation justification contract: " + message);
}

export function parseAnnotationJustifications(markdown) {
  const rows = new Map();
  const lineRe = /^\|\s*\`([^\`]+)\`\s*\|\s*(true|false)\s*\|\s*(.*?)\s*\|\s*(true|false)\s*\|\s*(.*?)\s*\|\s*(true|false)\s*\|\s*(.*?)\s*\|$/;

  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(lineRe);
    if (!match) continue;

    const [, name, readOnly, readWhy, destructive, destructiveWhy, openWorld, openWorldWhy] = match;
    if (rows.has(name)) fail("duplicate reviewer row for " + name);

    const justifications = {
      readOnlyHint: readWhy.trim(),
      destructiveHint: destructiveWhy.trim(),
      openWorldHint: openWorldWhy.trim(),
    };
    for (const key of KEYS) {
      if (justifications[key].length < 12) {
        fail(name + " has an empty or uninformative " + key + " justification");
      }
    }

    rows.set(name, {
      name,
      annotations: {
        readOnlyHint: readOnly === "true",
        destructiveHint: destructive === "true",
        openWorldHint: openWorld === "true",
      },
      justifications,
    });
  }

  if (rows.size === 0) fail("no reviewer rows found");
  return rows;
}

export async function loadAnnotationJustifications(path = DEFAULT_PATH) {
  return parseAnnotationJustifications(await readFile(path, "utf8"));
}

export function assertAnnotationJustificationsMatchTools(tools, rows) {
  if (!Array.isArray(tools)) fail("tools must be an array");
  if (!(rows instanceof Map)) fail("rows must be a Map");

  const toolsByName = new Map();
  for (const tool of tools) {
    const name = String(tool?.name || "").trim();
    if (!name) fail("live tool has no name");
    if (toolsByName.has(name)) fail("duplicate live tool " + name);
    toolsByName.set(name, tool);
  }

  const missing = [...toolsByName.keys()].filter(name => !rows.has(name)).sort();
  const stale = [...rows.keys()].filter(name => !toolsByName.has(name)).sort();
  if (missing.length) fail("missing reviewer rows for live tools: " + missing.join(", "));
  if (stale.length) fail("stale reviewer rows for non-live tools: " + stale.join(", "));

  for (const [name, tool] of toolsByName) {
    const row = rows.get(name);
    const actual = tool.annotations || {};
    for (const key of KEYS) {
      if (typeof actual[key] !== "boolean") fail(name + " is missing live boolean " + key);
      if (actual[key] !== row.annotations[key]) {
        fail(name + " " + key + " drift: live=" + actual[key] + " reviewer=" + row.annotations[key]);
      }
    }
  }

  const canonical = [...rows.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(row => ({
      name: row.name,
      annotations: row.annotations,
      justifications: row.justifications,
    }));

  return {
    tool_count: toolsByName.size,
    sha256: crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
