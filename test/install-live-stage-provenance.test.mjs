import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installer = readFileSync(new URL("../deploy/install-live.sh", import.meta.url), "utf8");

test("staged release tests borrow source Git metadata without copying .git", () => {
  assert.match(
    installer,
    /GIT_DIR="\$SOURCE_ROOT\/\.git" GIT_WORK_TREE="\$STAGE" "\$NPM_BIN" test --prefix "\$STAGE"/,
  );
  assert.match(installer, /git -C "\$SOURCE_ROOT" archive --format=tar "\$REPO_SHA" \| tar -x -C "\$STAGE"/);
  assert.doesNotMatch(installer, /cp\s+-[^\n]*\.git/);
  assert.doesNotMatch(installer, /mv\s+[^\n]*\.git/);
});

test("live service unit is rendered from the immutable release, not the source worktree", () => {
  assert.match(
    installer,
    /sed "s\|@NODE_BIN@\|\$NODE_BIN\|g" "\$RELEASE\/deploy\/zssh\.service\.in" > "\$UNIT"/,
  );
  assert.doesNotMatch(installer, /"\$SOURCE(?:_ROOT)?\/deploy\/zssh\.service\.in"/);
});
