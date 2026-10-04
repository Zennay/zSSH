# npm lockfile reproducibility decision — 2026-10-04

## Decision

zSSH commits `package-lock.json` and uses `npm ci` for CI plus immutable release installs. Direct runtime dependencies remain exact in `package.json`; the lockfile now freezes the full transitive graph and records the resolved artifact plus integrity digest for every installed package.

## Primary sources

- npm `npm ci`: https://docs.npmjs.com/cli/commands/npm-ci/
- npm `package-lock.json`: https://docs.npmjs.com/files/package-lock.json/

npm documents `npm ci` as the clean-install path for automated test/deployment environments. It requires an existing lockfile, fails when `package.json` and the lock disagree, and does not rewrite either manifest during installation.

npm's lockfile format records the complete package tree. For registry artifacts it records the resolved tarball and an integrity value, allowing the repository to bind installs to the exact dependency graph selected during review rather than resolving compatible transitive versions again at deployment time.

## zSSH invariant

1. `package.json` production dependencies use exact semver versions.
2. `package-lock.json` is committed with lockfile version 3 and its root dependency map exactly matches `package.json`.
3. Every currently locked external package has an exact version, npm registry tarball URL, and SHA-512 integrity digest.
4. CI, the final OpenAI production probe, the private immutable gateway installer, the public gateway installer, and the outbound target-agent installer use `npm ci` rather than `npm install`.
5. Changes to `package-lock.json`, the install-policy test, or release-critical installers retrigger the OpenAI public release contract.

This change does not assert that dependencies are intrinsically safe; it prevents an already-reviewed zSSH commit from silently resolving a different compatible transitive dependency graph later.
