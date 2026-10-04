import { pathToFileURL } from "node:url";

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_USER_TOKEN_VERIFY_URL = `${CLOUDFLARE_API_BASE_URL}/user/tokens/verify`;
export const CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS = 10_000;

function fail(message) {
  throw new Error(message);
}

function normalizeAccountId(accountId) {
  const value = String(accountId || "").trim();
  if (!value) return "";
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    fail("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID");
  }
  return value;
}

export function cloudflareTokenVerifyUrl({ accountId } = {}) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) return CLOUDFLARE_USER_TOKEN_VERIFY_URL;
  return `${CLOUDFLARE_API_BASE_URL}/accounts/${normalizedAccountId}/tokens/verify`;
}

function failTokenVerification(status, { accountOwned }) {
  const guidance = accountOwned
    ? "account-owned tokens require the matching CLOUDFLARE_ACCOUNT_ID and account token scope"
    : "user-owned tokens must come from My Profile > API Tokens; set CLOUDFLARE_ACCOUNT_ID only for an account-owned token";
  fail(
    `Cloudflare ${accountOwned ? "account-owned" : "user-owned"} API token verification failed: HTTP ${status}; ${guidance}`,
  );
}

export async function verifyCloudflareApiToken({
  apiToken,
  accountId,
  fetchImpl = fetch,
} = {}) {
  const token = String(apiToken || "").trim();
  if (!token) fail("CLOUDFLARE_API_TOKEN is required");

  const normalizedAccountId = normalizeAccountId(accountId);
  const accountOwned = normalizedAccountId.length > 0;
  const verifyUrl = cloudflareTokenVerifyUrl({ accountId: normalizedAccountId });

  let response;
  try {
    response = await fetchImpl(verifyUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    const name = String(error?.name || "");
    if (name === "TimeoutError" || name === "AbortError") {
      fail("Cloudflare token verification failed: request timed out");
    }
    fail("Cloudflare token verification failed: network request failed");
  }

  if (!response.ok) {
    failTokenVerification(response.status, { accountOwned });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    fail(`Cloudflare token verification failed: invalid JSON (HTTP ${response.status})`);
  }

  if (body?.success !== true) {
    failTokenVerification(response.status, { accountOwned });
  }

  const status = String(body?.result?.status || "").toLowerCase();
  if (status !== "active") {
    fail(`Cloudflare API token is not active (status=${status || "unknown"})`);
  }

  return {
    ok: true,
    status: "active",
  };
}

export async function main({ env = process.env, stdout = process.stdout } = {}) {
  const result = await verifyCloudflareApiToken({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
  });
  stdout.write(JSON.stringify(result, null, 2) + "\n");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
