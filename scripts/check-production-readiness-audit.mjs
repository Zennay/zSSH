#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { publicReleaseConfigPresence } from "./check-public-release-config.mjs";

const PROVIDER_LANES = {
  repository_governance: [
    "ZSSH_MAIN_PROTECTION_VERIFIED",
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

function configured(env, name) {
  return String(env[name] || "").trim().length > 0;
}

function laneStatus(env, names) {
  const present = Object.fromEntries(names.map(name => [name, configured(env, name)]));
  const missing = names.filter(name => !present[name]);
  return {
    ready: missing.length === 0,
    configured: present,
    missing,
  };
}

export function buildProductionReadinessAudit(env = process.env) {
  const lanes = Object.fromEntries(
    Object.entries(PROVIDER_LANES).map(([name, names]) => [name, laneStatus(env, names)])
  );
  const releaseConfig = publicReleaseConfigPresence(env);

  const nextActions = [];
  if (!lanes.repository_governance.ready) {
    nextActions.push({
      lane: "repository_governance",
      action: "Protect main against direct writes, require PR-based changes plus the zSSH CI/repository-hygiene check, run a controlled rejected-direct-push proof, then set ZSSH_MAIN_PROTECTION_VERIFIED=1.",
      missing: lanes.repository_governance.missing,
    });
  }
  if (!lanes.dns_publication.ready) {
    nextActions.push({
      lane: "dns_publication",
      action: "Configure protected Cloudflare zone ID/token, then run zSSH production DNS publish.",
      missing: lanes.dns_publication.missing,
    });
  }
  if (!lanes.auth0_preflight.ready) {
    nextActions.push({
      lane: "auth0_preflight",
      action: "Configure the production Auth0 issuer/management inputs, then run Auth0 production readiness.",
      missing: lanes.auth0_preflight.missing,
    });
  }
  if (!lanes.reviewer_fixture.ready) {
    nextActions.push({
      lane: "reviewer_fixture",
      action: "Finish the reviewer-facing demo/login/token/file fixture inputs before the final production probe.",
      missing: lanes.reviewer_fixture.missing,
    });
  }
  if (!lanes.portal_and_host_attestations.ready) {
    nextActions.push({
      lane: "portal_and_host_attestations",
      action: "Complete Verify Domain, Scan Tools, reviewer-login verification, and live desktop/mobile review before setting attestations.",
      missing: lanes.portal_and_host_attestations.missing,
    });
  }

  return {
    schema_version: 1,
    phase: "M5",
    goal: "public-plugin production submission",
    ready: {
      repository_governance: lanes.repository_governance.ready,
      dns_publication: lanes.dns_publication.ready,
      auth0_preflight: lanes.auth0_preflight.ready,
      reviewer_fixture: lanes.reviewer_fixture.ready,
      portal_and_host_attestations: lanes.portal_and_host_attestations.ready,
      final_release_config: releaseConfig.ok,
    },
    lanes,
    final_release_config: {
      ready: releaseConfig.ok,
      configured: releaseConfig.configured,
      missing: releaseConfig.missing,
    },
    next_actions: nextActions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildProductionReadinessAudit(process.env), null, 2));
}
