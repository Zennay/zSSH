# GitHub workflow Node.js runtime support — 2026-10-04

## Primary sources

- Node.js release archive: https://nodejs.org/en/download/archive/v20
- Node.js release index: https://nodejs.org/en/blog/release
- Node.js 22.23.3 LTS release: https://nodejs.org/en/blog/release/v22.23.3

Node.js 20 reached end of life in April 2026 and is no longer a supported release line. On 2026-09-23, Node.js 22.23.3 was the current 22.x LTS release.
The Node.js 22.23.3 distribution ships npm `10.9.9`, so zSSH treats that npm version as part of the reviewed release toolchain rather than leaving `npm ci` behavior implicit.

## zSSH decision

All active GitHub Actions workflows that execute zSSH JavaScript now request exact Node.js `22.23.3` through the already SHA-pinned `actions/setup-node` action.
Release package metadata declares `npm@10.9.9`; CI and the final production release fail closed if either Node or npm differs, and the final non-secret release evidence records both exact versions.

This change covers CI, governance, readiness, ingress, Auth0, DNS publication and final release/probe workflows. The live VPS installer still accepts Node.js >=20 until the installed service runtime has been independently observed and upgraded without risking an unplanned production outage.

A repository regression test scans every active workflow and fails if a setup-node runtime differs from `22.23.3` or if the EOL Node.js 20 release line returns.
