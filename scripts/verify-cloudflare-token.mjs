import { pathToFileURL } from "node:url";

const CLOUDFLARE_TOKEN_VERIFY_URL = "https://api.cloudflare.com/client/v4/user/tokens/verify";
export const CLOUDFLARE_TOKEN_VERIFY_TIMEOUT_MS = 10_000;

function fail(message) {
  throw new Error(message);
}

export async function verifyCloudflareApiToken({
  apiToken,
  fetchImpl = fetch,
} = {}) {
  const token = String(apiToken || "").trim();
  if (!token) fail("CLOUDFLARE_API_TOKEN is required");

  let response;
  try {
    response = await fetchImpl(CLOUDFLARE_TOKEN_VERIFY_URL, {
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

  let body;
  try {
    body = await response.json();
  } catch {
    fail(`Cloudflare token verification failed: invalid JSON (HTTP ${response.status})`);
  }

  if (!response.ok || body?.success !== true) {
    fail(
      `Cloudflare user-owned API token verification failed: HTTP ${response.status}; ` +
      "CLOUDFLARE_API_TOKEN must be a user-owned token from My Profile > API Tokens",
    );
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
