import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_READ_FILE,
  REVIEW_WRITE_FILE,
  reviewerFixtureReleaseMetadata,
} from "../scripts/reviewer-fixture-contract.mjs";

test("canonical reviewer fixture paths are safe to emit as release variables", () => {
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

test("temporary reviewer fixture paths never masquerade as production release values", () => {
  const result = reviewerFixtureReleaseMetadata({
    reviewFile: "/tmp/zssh-review/sample.txt",
    reviewWriteFile: "/tmp/zssh-review/output.txt",
  });
  assert.equal(result.release_compatible, false);
  assert.equal(result.release_variables, null);
  assert.match(result.release_blocker, /canonical submission paths/);
  assert.match(result.release_blocker, /\/srv\/zssh-review\/sample\.txt/);
  assert.match(result.release_blocker, /\/srv\/zssh-review\/output\.txt/);
});

test("partial reviewer fixture paths fail closed", () => {
  const result = reviewerFixtureReleaseMetadata({
    reviewFile: REVIEW_READ_FILE,
    reviewWriteFile: "",
  });
  assert.equal(result.release_compatible, false);
  assert.equal(result.release_variables, null);
});
