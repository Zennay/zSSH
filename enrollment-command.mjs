import net from "node:net";

// A personal code is deliberately short lived. Agent identity, once enrolled,
// is persistent and signed by the VPS's private Ed25519 key.
const CODE = /^enr_[A-Za-z0-9_-]{43}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

function validatedEnrollmentOriginAndRef({ gatewayUrl, installerRef }) {
  if (!GIT_SHA.test(String(installerRef || ""))) {
    throw new Error("installerRef must pin a full reviewed Git commit SHA");
  }
  const url = new URL(String(gatewayUrl || ""));
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || url.pathname !== "/" || url.port ||
    !url.hostname.includes(".") || url.hostname === "localhost" || net.isIP(url.hostname)
  ) {
    throw new Error("enrollment gateway requires a canonical HTTPS DNS origin");
  }
  return { gateway: url.origin, ref: installerRef };
}

export function renderEnrollmentInstallCommand({ code, gatewayUrl, installerRef }) {
  if (!CODE.test(String(code || ""))) throw new Error("invalid personal enrollment code");
  const { gateway } = validatedEnrollmentOriginAndRef({ gatewayUrl, installerRef });
  // The install endpoint supplies the immutable ref and gateway internally.
  // The code is in the user's one-time shell command, never in the HTTP URL.
  return "curl --proto '=https' --tlsv1.2 -fsSL " + gateway +
    "/install | sudo bash -s -- --enroll " + code;
}

export function renderEnrollmentBootstrapScript({ gatewayUrl, installerRef }) {
  const { gateway, ref } = validatedEnrollmentOriginAndRef({ gatewayUrl, installerRef });
  const pinnedUrl = "https://raw.githubusercontent.com/Zennay/zSSH/" + ref + "/deploy/install.sh";
  // URLs are validated HTTPS DNS origins and immutable hexadecimal commit IDs.
  // Never interpolate the user enrollment code into the fetched shell payload.
  return [
    "#!/usr/bin/env bash",
    "set -Eeuo pipefail",
    "if [[ \"$#\" -ne 2 || \"$1\" != \"--enroll\" ]]; then",
    "  echo 'zSSH: a personal --enroll code is required; generate one in your ChatGPT plugin.' >&2",
    "  exit 2",
    "fi",
    "if [[ ! \"$2\" =~ ^enr_[A-Za-z0-9_-]{43}$ ]]; then",
    "  echo 'zSSH: invalid personal enrollment code.' >&2",
    "  exit 2",
    "fi",
    "code=\"$2\"",
    "bootstrap=\"$(mktemp \"${TMPDIR:-/tmp}/zssh-install.XXXXXXXX\")\"",
    "trap 'rm -f \"$bootstrap\"' EXIT",
    "curl --proto '=https' --tlsv1.2 -fsSL '" + pinnedUrl + "' -o \"$bootstrap\"",
    "bash \"$bootstrap\" --enroll \"$code\" --gateway '" + gateway + "' --ref '" + ref + "'",
    "unset code",
    ""
  ].join("\n");
}
