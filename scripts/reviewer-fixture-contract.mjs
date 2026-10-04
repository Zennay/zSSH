export const REVIEW_READ_FILE = "/srv/zssh-review/sample.txt";
export const REVIEW_WRITE_FILE = "/srv/zssh-review/output.txt";

function clean(value) {
  return String(value || "").trim();
}

export function reviewerFixturePathIssues(env = {}) {
  const issues = [];
  const readFile = clean(env.ZSSH_REVIEW_FILE);
  const writeFile = clean(env.ZSSH_REVIEW_WRITE_FILE);

  if (readFile && readFile !== REVIEW_READ_FILE) {
    issues.push({
      name: "ZSSH_REVIEW_FILE",
      reason: `must exactly match ${REVIEW_READ_FILE}, the path published in the submission reviewer test case`,
    });
  }

  if (writeFile && writeFile !== REVIEW_WRITE_FILE) {
    issues.push({
      name: "ZSSH_REVIEW_WRITE_FILE",
      reason: `must exactly match ${REVIEW_WRITE_FILE}, the path published in the submission reviewer test case`,
    });
  }

  return issues;
}

export function assertReviewerFixturePaths(env = {}) {
  const issues = reviewerFixturePathIssues(env);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(`${first.name} ${first.reason}`);
  }
  return {
    review_file: REVIEW_READ_FILE,
    review_write_file: REVIEW_WRITE_FILE,
  };
}
