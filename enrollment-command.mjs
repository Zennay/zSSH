// Construct only server-issued, time-limited enrollment commands.
// A user deliberately pastes the one-use code into the terminal; never use a
// permanent API credential, an SSH password, or a ChatGPT access token here.
const CODE = /^enr_[A-Za-z0-9_-]{43}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

export function renderEnrollmentInstallCommand({ code, gatewayUrl, installerRef }) {
  if (!CODE.test(String(code || ""))) throw new Error("invalid personal enrollment code");
  if (!GIT_SHA.test(String(installerRef || ""))) {
    throw new Error("installerRef must pin a full reviewed Git commit SHA");
  }
  const url = new URL(String(gatewayUrl || ""));
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || url.pathname !== "/" || url.port ||
    !url.hostname.includes(".") || url.hostname === "localhost"
  ) {
    throw new Error("enrollment gateway requires a canonical HTTPS DNS origin");
  }
  // Both arguments are tightly validated alphanumeric/URL values, never
  // evaluated as shell source by the gateway.
  const installerUrl = "https://raw.githubusercontent.com/Zennay/zSSH/" + installerRef + "/deploy/install.sh";
  return "curl --proto '=https' --tlsv1.2 -fsSL " + installerUrl +
    " | sudo bash -s -- --enroll " + code + " --gateway " + url.origin + " --ref " + installerRef;
}
