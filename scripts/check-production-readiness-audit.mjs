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
import { resolveAuth0ManagementBaseUrl } from "./check-auth0-production.mjs";
import { validateCloudflareZoneId } from "./publish-cloudflare-dns.mjs";
import { reviewerFixturePathIssues } from "./reviewer-fixture-contract.mjs";

const PROVIDER_LANES = {
  repository_governance: [
    "ZSSH_MAIN_PROTECTION_VERIFIED",
    "ZSSH_MAIN_BRANCH_PROTECTED",
  ],
  dns_publication: [
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

const DNS_RESOLVED_PUBLIC_ORIGIN_STAGES = new Set([
  "https_health",
  "mcp_auth",
  "oauth_metadata",
  "transport",
  "ready",
]);

const PUBLIC_INGRESS_READY_STAGES = new Set([
  "oauth_metadata",
  "ready",
]);

function value(env, name) {
  return String(env[name] || "").trim();
}

function configured(env, name) {
  return value(env, name).length > 0;
}

function dnsPublicationObserved(env) {
  return DNS_RESOLVED_PUBLIC_ORIGIN_STAGES.has(value(env, "ZSSH_PUBLIC_ORIGIN_STAGE"));
}

function validationIssue(name, reason) {
  return { name, reason };
}

function validateHttpsUrl(env, name, { requirePublicHostname = false, allowFragment = true } = {}) {
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

  if (!allowFragment && url.hash) {
    return validationIssue(name, "must not contain a URL fragment");
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

function auth0ManagementBaseConfigured(env) {
  if (configured(env, "AUTH0_MANAGEMENT_BASE_URL")) return true;
  if (!configured(env, "ZSSH_OAUTH_ISSUER")) return false;

  try {
    resolveAuth0ManagementBaseUrl(value(env, "ZSSH_OAUTH_ISSUER"), "");
    return true;
  } catch {
    return false;
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

  const issuerIssue = validateHttpsUrl(env, "ZSSH_OAUTH_ISSUER", { requirePublicHostname: true });
  issues.push(
    issuerIssue,
    validateMinLength(env, "AUTH0_MANAGEMENT_API_TOKEN", 20),
  );

  if (!issuerIssue && configured(env, "AUTH0_MANAGEMENT_BASE_URL")) {
    try {
      resolveAuth0ManagementBaseUrl(
        value(env, "ZSSH_OAUTH_ISSUER"),
        value(env, "AUTH0_MANAGEMENT_BASE_URL"),
      );
    } catch (error) {
      issues.push(
        validationIssue(
          "AUTH0_MANAGEMENT_BASE_URL",
          String(error?.message || "must be a canonical Auth0 management origin"),
        ),
      );
    }
  }

  return compactIssues(issues);
}

function validateReviewerFixtureLane(env) {
  const reviewLoginIssue = validateHttpsUrl(
    env,
    "ZSSH_REVIEW_LOGIN_URL",
    { requirePublicHostname: true },
  );
  const issues = compactIssues([
    validateHttpsUrl(env, "ZSSH_PLUGIN_DEMO_RECORDING_URL", {
      requirePublicHostname: true,
      allowFragment: false,
    }),
    validateMinLength(env, "ZSSH_REVIEW_ACCESS_TOKEN", 20),
    reviewLoginIssue,
  ]);

  const issuerIssue = validateHttpsUrl(
    env,
    "ZSSH_OAUTH_ISSUER",
    { requirePublicHostname: true },
  );
  if (
    !reviewLoginIssue &&
    !issuerIssue &&
    configured(env, "ZSSH_REVIEW_LOGIN_URL") &&
    configured(env, "ZSSH_OAUTH_ISSUER")
  ) {
    try {
      const reviewLoginUrl = new URL(value(env, "ZSSH_REVIEW_LOGIN_URL"));
      const issuerUrl = new URL(value(env, "ZSSH_OAUTH_ISSUER"));
      if (reviewLoginUrl.origin !== issuerUrl.origin) {
        issues.push(
          validationIssue(
            "ZSSH_REVIEW_LOGIN_URL",
            "must use the same origin as ZSSH_OAUTH_ISSUER",
          ),
        );
      }
    } catch {
      // URL syntax is reported by the field-local validators.
    }
  }

  issues.push(...reviewerFixturePathIssues(env));

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
      const expectedOriginHref = `${mcpUrl.origin}/`;
      if (verifiedOrigin.href !== expectedOriginHref) {
        issues.push(
          validationIssue(
            "ZSSH_OPENAI_VERIFIED_MCP_ORIGIN",
            "must be the exact origin of ZSSH_PLUGIN_MCP_URL without path, query, or fragment",
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
  const present = Object.fromEntries(names.map(name => [
    name,
    laneName === "auth0_preflight" && name === "AUTH0_MANAGEMENT_BASE_URL"
      ? auth0ManagementBaseConfigured(env)
      : configured(env, name),
  ]));
  const invalid = LANE_VALIDATORS[laneName]?.(env) || [];

  if (laneName === "dns_publication") {
    const observed = dnsPublicationObserved(env);
    return {
      ready: observed && invalid.length === 0,
      configured: present,
      missing: observed || present.CLOUDFLARE_API_TOKEN ? [] : ["CLOUDFLARE_API_TOKEN"],
      invalid,
    };
  }

  const missing = names.filter(name => !present[name]);
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
  const publicOriginStage = value(env, "ZSSH_PUBLIC_ORIGIN_STAGE");
  lanes.public_ingress = {
    ready: PUBLIC_INGRESS_READY_STAGES.has(publicOriginStage),
    configured: {
      ZSSH_PUBLIC_ORIGIN_STAGE: configured(env, "ZSSH_PUBLIC_ORIGIN_STAGE"),
    },
    missing: [],
    invalid: [],
  };
  const releasePresence = publicReleaseConfigPresence(env);
  const releaseConfig = finalReleaseValidation(env, releasePresence);

  const nextActions = [];
  if (!lanes.repository_governance.ready) {
    nextActions.push({
      lane: "repository_governance",
      gate_kind: "derived_evidence",
      requires_external_input: false,
      action: "Re-run immutable GitHub governance verification: main must be protected and the canonical issue #100 rejected-direct-write evidence plus canary ancestry must verify. Do not configure a persistent governance attestation.",
      missing: lanes.repository_governance.missing,
      invalid: lanes.repository_governance.invalid,
    });
  }
  if (!lanes.dns_publication.ready) {
    const tokenPresent = configured(env, "CLOUDFLARE_API_TOKEN");
    const configInvalid = lanes.dns_publication.invalid.length > 0;
    nextActions.push({
      lane: "dns_publication",
      gate_kind: configInvalid
        ? "provider_configuration"
        : tokenPresent
          ? "provider_execution"
          : "provider_credentials",
      requires_external_input: configInvalid || !tokenPresent,
      action: configInvalid
        ? "Repair or remove the invalid optional Cloudflare zone override, then rerun protected readiness."
        : tokenPresent
          ? `Run the guarded zSSH production DNS publisher; live public-origin evidence is still at stage ${value(env, "ZSSH_PUBLIC_ORIGIN_STAGE") || "unknown"}.`
          : "Provision a protected Cloudflare API token scoped only to cheapgpt.shop with Zone > DNS > Edit + Zone > Zone > Read. For durable CI/CD prefer an account-owned token and set CLOUDFLARE_ACCOUNT_ID to its 32-character account ID; user-owned tokens from My Profile > API Tokens remain supported when CLOUDFLARE_ACCOUNT_ID is unset. The preflight uses /accounts/{account_id}/tokens/verify only for the explicit account path and /user/tokens/verify otherwise. Then run zSSH production DNS publish. CLOUDFLARE_ZONE_ID remains an optional legacy override for DNS-write-only tokens.",
      missing: lanes.dns_publication.missing,
      invalid: lanes.dns_publication.invalid,
    });
  }
  if (lanes.dns_publication.ready && !lanes.public_ingress.ready) {
    nextActions.push({
      lane: "public_ingress",
      gate_kind: "internal_deployment",
      requires_external_input: false,
      action: `Public DNS is resolved but the zSSH public origin is stalled at stage ${publicOriginStage || "unknown"}. Run the canonical zCloud VPS rollout for zssh-public.service plus transactional Caddy promotion, then rerun the GitHub-hosted external ingress preflight.`,
      missing: [],
      invalid: [],
    });
  }
  if (!lanes.auth0_preflight.ready) {
    nextActions.push({
      lane: "auth0_preflight",
      gate_kind: "provider_configuration",
      requires_external_input: true,
      action: "Provision the production Auth0 issuer and Management API token, then run Auth0 production readiness. For canonical *.auth0.com issuers the management origin is derived automatically; custom Auth0 domains still require an explicit canonical *.auth0.com AUTH0_MANAGEMENT_BASE_URL.",
      missing: lanes.auth0_preflight.missing,
      invalid: lanes.auth0_preflight.invalid,
    });
  }
  if (!lanes.reviewer_fixture.ready) {
    nextActions.push({
      lane: "reviewer_fixture",
      gate_kind: "reviewer_configuration",
      requires_external_input: true,
      action: "Provision the reviewer-facing demo/login/token inputs before the final production probe.",
      missing: lanes.reviewer_fixture.missing,
      invalid: lanes.reviewer_fixture.invalid,
    });
  }
  if (!lanes.portal_and_host_attestations.ready) {
    nextActions.push({
      lane: "portal_and_host_attestations",
      gate_kind: "portal_attestation",
      requires_external_input: true,
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
      gate_kind: "internal_validation",
      requires_external_input: false,
      action: "Repair the remaining cross-lane or stale release binding before the protected production probe.",
      missing: releaseConfig.missing,
      invalid: releaseConfig.invalid,
    });
  }

  const internalActionGates = nextActions
    .filter(item => !item.requires_external_input)
    .map(item => item.lane);
  const externalInputGates = nextActions
    .filter(item => item.requires_external_input)
    .map(item => item.lane);
  const executionState = nextActions.length === 0
    ? "ready"
    : internalActionGates.length > 0
      ? "internal_action_available"
      : "external_input_only";
  const blockingAction = nextActions[0] || null;

  return {
    schema_version: 4,
    phase: "M5",
    goal: "public-plugin production submission",
    ready: {
      repository_governance: lanes.repository_governance.ready,
      dns_publication: lanes.dns_publication.ready,
      public_ingress: lanes.public_ingress.ready,
      auth0_preflight: lanes.auth0_preflight.ready,
      reviewer_fixture: lanes.reviewer_fixture.ready,
      portal_and_host_attestations: lanes.portal_and_host_attestations.ready,
      final_release_config: releaseConfig.ready,
    },
    lanes,
    final_release_config: releaseConfig,
    execution_state: executionState,
    internal_action_gates: internalActionGates,
    external_input_gates: externalInputGates,
    blocking_gate: blockingAction?.lane || null,
    blocking_action: blockingAction,
    next_actions: nextActions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildProductionReadinessAudit(process.env), null, 2));
}
