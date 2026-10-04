import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_READ_FILE,
  REVIEW_WRITE_FILE,
  reviewerFixtureReleaseMetadata,
} from "../scripts/reviewer-fixture-contract.mjs";

test("canonical reviewer fixture paths emit production release variables", () => {
  assert.deepEqual(
    reviewerFixtureReleaseMetadata({
      reviewFile: REVIEW_READ_FILE,
      reviewWriteFile: REVIEW_WRITE_FILE,
    }),
    {
      release_compatible: true,
      release_variables: {
        ZSSH_REVIEW_FILE: REVIEW_READ_FILE,
        ZSSH_REVIEW_WRITE_FILE: REVIEW_WRITE_FILE,
      },
      release_blocker: null,
    },
  );
});

test("noncanonical reviewer paths fail closed without copyable release variables", () => {
  const result = reviewerFixtureReleaseMetadata({
    reviewFile: "/tmp/zssh-review/sample.txt",
    reviewWriteFile: "/tmp/zssh-review/output.txt",
  });
  assert.equal(result.release_compatible, false);
  assert.equal(result.release_variables, null);
  assert.match(result.release_blocker, /canonical submitted paths/);
  assert.match(result.release_blocker, /do not copy dev\/test paths into openai-production/);
});

test("partial reviewer fixture configuration also fails closed", () => {
  for (const fixture of [
    { reviewFile: REVIEW_READ_FILE, reviewWriteFile: "" },
    { reviewFile: "", reviewWriteFile: REVIEW_WRITE_FILE },
    {},
  ]) {
    const result = reviewerFixtureReleaseMetadata(fixture);
    assert.equal(result.release_compatible, false);
    assert.equal(result.release_variables, null);
  }
});
