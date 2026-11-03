/**
 * A second (third…) server on the same data folder, as its own process: tests/auth-migration.test.ts starts several at
 * once. Loads the sign-in modules, waits for the "go" file so they all act at the same moment, then:
 * - start: sets the store up (moves auth.json in when it is waiting) and prints the mode and the number of accounts;
 * - signup <email>: signs up with that email and prints "ok" or the refusal's status.
 * Run with: node --import tests/helpers/ts-register.mjs tests/helpers/auth-child.ts <action> <arg> <go file>
 */
import fs from "node:fs";

const [action, arg, go] = process.argv.slice(2);
const auth = await import("@/server/auth");
const store = await import("@/server/auth-store");
while (go && !fs.existsSync(go)) await new Promise((r) => setTimeout(r, 2));
let out: Record<string, unknown>;
if (action === "start") {
  const mode = store.authStoreMode();
  out = { mode, accounts: auth.listAccounts().length };
} else {
  try {
    auth.createAccount(arg, "long enough");
    out = { result: "ok" };
  } catch (e) {
    out = { result: String((e as { status?: number }).status ?? (e as Error).message) };
  }
}
console.log(`RESULT ${JSON.stringify(out)}`);
