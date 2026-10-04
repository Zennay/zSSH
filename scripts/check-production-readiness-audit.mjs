#!/usr/bin/env node
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  isNonPublicHostname,
  validatePublicMcpUrl,
} from "../release-contract.mjs";
import {
  publicReleaseConfigPresence,
  validatePublicReleaseConfig,
} from "./check-public-release-config.mjs";
import { validateCloudflareZoneId } from "./publish-cloudflare-dns.mjs";

const PROVIDER_LANES = {
  repository_governance: [
    "ZSSH_MAIN_PROTECTION_VERIFIED",
    "ZSSH_MAIN_BRANCH_PROTECTED",
  ],
  dns_publication: [
    "CLOUDFLARE_ZONE_ID",
    "CLOUDFLARE_API_TOKEN",
  ],
  auth0_preflight: [
    "ZSSH_PLUGIN_MCP_URL",
    "ZSSH_OAUTH_ISSUER",
    "AUTH0_MANAGEMENT_BASE_URL",
    "AUTH0_MANAGEMENT_API_TOKEN",
  ],
  reviewer_fixture: [
    "ZSSH_PLUGIN_DEMO_RECORDING_URL",
    "ZSSH_REVIEW_ACCESS_TOKEN",
    "ZSSH_REVIEW_LOGIN_URL",
    "ZSSH_REVIEW_FILE",
    "ZSSH_REVIEW_WRITE_FILE",
  ],
  portal_and_host_attestations: [
    "ZSSH_REVIEW_LOGIN_VERIFIED_URL",
    "ZSSH_REVIEW_CREDENTIALS_VERIFIED",
    "ZSSH_OPENAI_DOMAIN_VERIFIED",
    "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN",
    "ZSSH_OPENAI_TOOL_SCAN_VERIFIED",
    "ZSSH_OPENAI_TOOL_SCAN_SHA256",
    "ZSSH_CHATGPT_DESKTOP_REVIEWED",
    "ZSSH_CHATGPT_MOBILE_REVIEWED",
    "ZSSH_CHATGPT_REVIEW_SHA256",
    "OPENAI_APPS_CHALLENGE_TOKEN",
  ],
};

function value(env, name) {
  return String(env[name] || "").trim();
}

function configured(env, name) {
  return value(env, name).length > 0;
}

function validationIssue(name, reason) {
  return { name, reason };
}

function validateHttpsUrl(env, name, { requirePublicHostname = false } = {}) {
  if (!configured(env, name)) return null;

  let url;
  try {
    url = new URL(value(env, name));
  } catch {
    return validationIssue(name, "must be a valid URL");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    return validationIssue(name, "must be an HTTPS URL without embedded credentials");
  }

  if (
    requirePublicHostname &&
    (net.isIP(url.hostname) || !url.hostname.includes(".") || isNonPublicHostname(url.hostname))
  ) {
    return validationIssue(name, "must use a public DNS hostname");
  }

  return null;
}

function validateMinLength(env, name, minLength) {
  if (!configured(env, name)) return null;
  if (value(env, name).length < minLength) {
    return validationIssue(name, `must be at least ${minLength} characters`);
  }
  return null;
}

function validateExactFlag(env, name) {
  if (!configured(env, name)) return null;
  if (value(env, name) !== "1") {
    return validationIssue(name, "must be exactly 1 after the corresponding verification has passed");
  }
  return null;
}

function validateSha256(env, name) {
  if (!configured(env, name)) return null;
  if (!/^[a-f0-9]{64}$/.test(value(env, name))) {
    return validationIssue(name, "must be a 64-character lowercase SHA-256 fingerprint");
  }
  return null;
}

function compactIssues(issues) {
  return issues.filter(Boolean);
}

function validateDnsLane(env) {
  if (!configured(env, "CLOUDFLARE_ZONE_ID")) return [];

  try {
    validateCloudflareZoneId(value(env, "CLOUDFLARE_ZONE_ID"));
    return [];
  } catch {
    return [
      validationIssue(
        "CLOUDFLARE_ZONE_ID",
        "must be a 32-character hexadecimal Cloudflare zone ID",
      ),
    ];
  }
}

function validateAuth0Lane(env) {
  const issues = [];

  if (configured(env, "ZSSH_PLUGIN_MCP_URL")) {
    try {
      validatePublicMcpUrl(value(env, "ZSSH_PLUGIN_MCP_URL"), {
        name: "ZSSH_PLUGIN_MCP_URL",
      });
    } catch {
      issues.push(
        validationIssue(
          "ZSSH_PLUGIN_MCP_URL",
          "must be the public HTTPS /mcp endpoint without query parameters or credentials",
        ),
      );
    }
  }

  issues.push(
    validateHttpsUrl(env, "ZSSH_OAUTH_ISSUER", { requirePublicHostname: true }),
    validateHttpsUrl(env, "AUTH0_MANAGEMENT_BASE_URL", { requirePublicHostname: true }),
    validateMinLength(env, "AUTH0_MANAGEMENT_API_TOKEN", 20),
  );

  return compactIssues(issues);
}

function validateReviewerFixtureLane(env) {
  const issues = compactIssues([
    validateHttpsUrl(env, "ZSSH_PLUGIN_DEMO_RECORDING_URL"),
    validateMinLength(env, "ZSSH_REVIEW_ACCESS_TOKEN", 20),
    validateHttpsUrl(env, "ZSSH_REVIEW_LOGIN_URL", { requirePublicHostname: true }),
  ]);

  for (const name of ["ZSSH_REVIEW_FILE", "ZSSH_REVIEW_WRITE_FILE"]) {
    if (configured(env, name) && !path.isAbsolute(value(env, name))) {
      issues.push(validationIssue(name, "must be an absolute path on the reviewer target"));
    }
  }

  if (
    configured(env, "ZSSH_REVIEW_FILE") &&
    configured(env, "ZSSH_REVIEW_WRITE_FILE") &&
    path.normalize(value(env, "ZSSH_REVIEW_FILE")) ===
      path.normalize(value(env, "ZSSH_REVIEW_WRITE_FILE"))
  ) {
    issues.push(
      validationIssue(
        "ZSSH_REVIEW_WRITE_FILE",
        "must be different from ZSSH_REVIEW_FILE",
      ),
    );
  }

  return issues;
}

function validatePortalLane(env) {
  const issues = compactIssues([
    validateHttpsUrl(env, "ZSSH_REVIEW_LOGIN_VERIFIED_URL", { requirePublicHostname: true }),
    validateExactFlag(env, "ZSSH_REVIEW_CREDENTIALS_VERIFIED"),
    validateExactFlag(env, "ZSSH_OPENAI_DOMAIN_VERIFIED"),
    validateHttpsUrl(env, "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN", { requirePublicHostname: true }),
    validateExactFlag(env, "ZSSH_OPENAI_TOOL_SCAN_VERIFIED"),
    validateSha256(env, "ZSSH_OPENAI_TOOL_SCAN_SHA256"),
    validateExactFlag(env, "ZSSH_CHATGPT_DESKTOP_REVIEWED"),
    validateExactFlag(env, "ZSSH_CHATGPT_MOBILE_REVIEWED"),
    validateSha256(env, "ZSSH_CHATGPT_REVIEW_SHA256"),
    validateMinLength(env, "OPENAI_APPS_CHALLENGE_TOKEN", 16),
  ]);

  if (
    configured(env, "ZSSH_REVIEW_LOGIN_URL") &&
    configured(env, "ZSSH_REVIEW_LOGIN_VERIFIED_URL")
  ) {
    try {
      const expected = new URL(value(env, "ZSSH_REVIEW_LOGIN_URL"));
      const verified = new URL(value(env, "ZSSH_REVIEW_LOGIN_VERIFIED_URL"));
      if (expected.href !== verified.href) {
        issues.push(
          validationIssue(
            "ZSSH_REVIEW_LOGIN_VERIFIED_URL",
            "must exactly match the reviewer login URL that was tested",
          ),
        );
      }
    } catch {
      // URL syntax is reported by the lane-local validators.
    }
  }

  if (
    configured(env, "ZSSH_PLUGIN_MCP_URL") &&
    configured(env, "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN")
  ) {
    try {
      const mcpUrl = validatePublicMcpUrl(value(env, "ZSSH_PLUGIN_MCP_URL"), {
        name: "ZSSH_PLUGIN_MCP_URL",
      });
      const verifiedOrigin = new URL(value(env, "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN"));
      if (verifiedOrigin.origin !== mcpUrl.origin || verifiedOrigin.pathname !== "/") {
        issues.push(
          validationIssue(
            "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN",
            "must be the exact origin of ZSSH_PLUGIN_MCP_URL",
          ),
        );
      }
    } catch {
      // The malformed field is reported by its owning lane.
    }
  }

  return issues;
}

const LANE_VALIDATORS = {
  repository_governance: env => compactIssues([
    validateExactFlag(env, "ZSSH_MAIN_PROTECTION_VERIFIED"),
    validateExactFlag(env, "ZSSH_MAIN_BRANCH_PROTECTED"),
  ]),
  dns_publication: validateDnsLane,
  auth0_preflight: validateAuth0Lane,
  reviewer_fixture: validateReviewerFixtureLane,
  portal_and_host_attestations: validatePortalLane,
};

function laneStatus(env, laneName, names) {
  const present = Object.fromEntries(names.map(name => [name, configured(env, name)]));
  const missing = names.filter(name => !present[name]);
  const invalid = LANE_VALIDATORS[laneName]?.(env) || [];

  return {
    ready: missing.length === 0 && invalid.length === 0,
    configured: present,
    missing,
    invalid,
  };
}

function finalReleaseValidation(env, presence) {
  if (!presence.ok) {
    return {
      ready: false,
      configured: presence.configured,
      missing: presence.missing,
      invalid: [],
    };
  }

  try {
    validatePublicReleaseConfig(env);
    return {
      ready: true,
      configured: presence.configured,
      missing: [],
      invalid: [],
    };
  } catch (error) {
    return {
      ready: false,
      configured: presence.configured,
      missing: [],
      invalid: [
        validationIssue(
          "FINAL_RELEASE_CONFIG",
          String(error?.message || "release configuration validation failed"),
        ),
      ],
    };
  }
}

export function buildProductionReadinessAudit(env = process.env) {
  const lanes = Object.fromEntries(
    Object.entries(PROVIDER_LANES).map(([name, names]) => [
      name,
      laneStatus(env, name, names),
    ])
  );
  const releasePresence = publicReleaseConfigPresence(env);
  const releaseConfig = finalReleaseValidation(env, releasePresence);

  const nextActions = [];
  if (!lanes.repository_governance.ready) {
    nextActions.push({
      lane: "repository_governance",
      action: "GitHub must report main as protected, then require PR-based changes plus the zSSH CI/repository-hygiene check, run a controlled rejected-direct-push proof, and only then set ZSSH_MAIN_PROTECTION_VERIFIED=1.",
      missing: lanes.repository_governance.missing,
      invalid: lanes.repository_governance.invalid,
    });
  }
  if (!lanes.dns_publication.ready) {
    nextActions.push({
      lane: "dns_publication",
      action: "Configure valid protected Cloudflare zone ID/token, then run zSSH production DNS publish.",
      missing: lanes.dns_publication.missing,
      invalid: lanes.dns_publication.invalid,
    });
  }
  if (!lanes.auth0_preflight.ready) {
    nextActions.push({
      lane: "auth0_preflight",
      action: "Configure valid production Auth0 issuer/management inputs, then run Auth0 production readiness.",
      missing: lanes.auth0_preflight.missing,
      invalid: lanes.auth0_preflight.invalid,
    });
  }
  if (!lanes.reviewer_fixture.ready) {
    nextActions.push({
      lane: "reviewer_fixture",
      action: "Finish the reviewer-facing demo/login/token/file fixture inputs before the final production probe.",
      missing: lanes.reviewer_fixture.missing,
      invalid: lanes.reviewer_fixture.invalid,
    });
  }
  if (!lanes.portal_and_host_attestations.ready) {
    nextActions.push({
      lane: "portal_and_host_attestations",
      action: "Complete Verify Domain, Scan Tools, reviewer-login verification, and live desktop/mobile review before setting attestations.",
      missing: lanes.portal_and_host_attestations.missing,
      invalid: lanes.portal_and_host_attestations.invalid,
    });
  }

  if (
    Object.values(lanes).every(lane => lane.ready) &&
    !releaseConfig.ready
  ) {
    nextActions.push({
      lane: "final_release_config",
      action: "Repair the remaining cross-lane or stale release binding before the protected production probe.",
      missing: releaseConfig.missing,
      invalid: releaseConfig.invalid,
    });
  }

  return {
    schema_version: 2,
    phase: "M5",
    goal: "public-plugin production submission",
    ready: {
      repository_governance: lanes.repository_governance.ready,
      dns_publication: lanes.dns_publication.ready,
      auth0_preflight: lanes.auth0_preflight.ready,
      reviewer_fixture: lanes.reviewer_fixture.ready,
      portal_and_host_attestations: lanes.portal_and_host_attestations.ready,
      final_release_config: releaseConfig.ready,
    },
    lanes,
    final_release_config: releaseConfig,
    next_actions: nextActions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildProductionReadinessAudit(process.env), null, 2));
}
