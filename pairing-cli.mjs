#!/usr/bin/env node
import { approvePairing, listPairings, revokePairing } from "./pairing.mjs";

const [command, value] = process.argv.slice(2);

try {
  let result;
  if (command === "list") {
    result = await listPairings();
  } else if (command === "approve") {
    if (!value) throw new Error("usage: node pairing-cli.mjs approve <pairing-request-id>");
    result = await approvePairing(value);
  } else if (command === "revoke") {
    if (!value) throw new Error("usage: node pairing-cli.mjs revoke <profile-id>");
    result = await revokePairing(value);
  } else {
    throw new Error("usage: node pairing-cli.mjs <list|approve|revoke> [id]");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(String(err?.message || err));
  process.exitCode = 1;
}
