import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAnnotationJustificationsMatchTools,
  parseAnnotationJustifications,
} from "../annotation-justifications.mjs";

const markdown = `# Review
| Tool | readOnlyHint | Justification | destructiveHint | Justification | openWorldHint | Justification |
| --- | --- | --- | --- | --- | --- | --- |
| \`read_status\` | true | Reads bounded private status only. | false | Does not mutate target state. | false | Reads one paired private target only. |
| \`write_file\` | false | Writes a requested bounded file. | true | Can overwrite an existing file. | false | Writes only to one paired private target. |
`;

const tools = [
  { name: "read_status", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "write_file", annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
];

test("annotation reviewer rows bind exactly to the live tool annotations", () => {
  const result = assertAnnotationJustificationsMatchTools(tools, parseAnnotationJustifications(markdown));
  assert.equal(result.tool_count, 2);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("annotation reviewer rows fail on missing, stale, or drifted tools", () => {
  const rows = parseAnnotationJustifications(markdown);
  assert.throws(
    () => assertAnnotationJustificationsMatchTools(tools.slice(0, 1), rows),
    /stale reviewer rows.*write_file/
  );
  assert.throws(
    () => assertAnnotationJustificationsMatchTools([...tools, { name: "new_tool", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }], rows),
    /missing reviewer rows.*new_tool/
  );
  const drifted = tools.map(tool => tool.name === "write_file"
    ? { ...tool, annotations: { ...tool.annotations, destructiveHint: false } }
    : tool);
  assert.throws(
    () => assertAnnotationJustificationsMatchTools(drifted, rows),
    /write_file destructiveHint drift/
  );
});

test("annotation reviewer rows reject duplicate or uninformative justifications", () => {
  assert.throws(
    () => parseAnnotationJustifications(markdown + "\n" + markdown.split("\n")[3]),
    /duplicate reviewer row/
  );
  assert.throws(
    () => parseAnnotationJustifications("| \`x\` | true | short | false | too short | false | short |"),
    /uninformative/
  );
});
