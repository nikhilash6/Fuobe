import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelDef, ModelRoute } from "@/lib/catalog/types";
import { startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";

/**
 * Your keys: a key never shows up in an error. The stand-ins here refuse with a body that repeats the request's
 * Authorization header (as some proxies do): the message Fuobe keeps holds neither the key nor either half of a fal.ai
 * key_id:key_secret. An account's refused key, or empty balance, is said the way to fix it.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-keys-redaction-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting } = await import("@/server/settings");
const { runAsTenant } = await import("@/server/tenant");
const { falProvider } = await import("@/server/providers/fal");
const { replicateProvider } = await import("@/server/providers/replicate");
const { redactKey } = await import("@/server/provider-keys");

const ECHO_FAL = "echo-key-id-1234:echo-key-secret-5678";
const ECHO_REP = "r8_echoTokenThatLeaks";
const BROKE_FAL = "broke-key-id-9999:broke-key-secret-0000";

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  fal.keys[ECHO_FAL] = "echo";
  fal.keys[BROKE_FAL] = "broke";
  rep.keys[ECHO_REP] = "echo";
  rep.keys["r8_brokeToken"] = "broke";
  auth.setPassword("install password");
  A = auth.createAccount("redact-a@example.com", "long enough").id;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  await fal.close();
  await rep.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const model = { id: "m", name: "M", kind: "image", engine: "cloud", routes: [] } as unknown as ModelDef;
const falRoute = { op: "text-to-image", provider: "fal", endpoint: "fal-ai/flux/dev", map: { prompt: "prompt" } } as unknown as ModelRoute;
const repRoute = { op: "text-to-image", provider: "replicate", endpoint: "black-forest-labs/flux-dev", map: { prompt: "prompt" } } as unknown as ModelRoute;
const input = { prompt: "x" };

const failure = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a failure");
};
const clean = (text: string, key: string) => {
  expect(text).not.toContain(key);
  for (const half of key.split(":")) expect(text).not.toContain(half);
};

describe("a key never shows up in an error", () => {
  it("redacts the key and each half of a fal.ai key", () => {
    expect(redactKey(`Key ${ECHO_FAL} and echo-key-secret-5678 alone`, ECHO_FAL)).toBe("Key •••• and •••• alone");
    expect(redactKey("nothing here", "")).toBe("nothing here");
  });

  it("the owner's refused key: the error is kept, the key isn't", async () => {
    setSetting("falKey", ECHO_FAL);
    setSetting("replicateToken", ECHO_REP);
    try {
      const f = await failure(() => falProvider.submit({ generationId: "g", model, route: falRoute, input }));
      expect(f).toMatch(/^fal 401: Invalid credentials: Key ••••/);
      clean(f, ECHO_FAL);
      const r = await failure(() => replicateProvider.submit({ generationId: "g", model, route: repRoute, input }));
      expect(r).toMatch(/^replicate 401: Invalid credentials: Bearer ••••/);
      clean(r, ECHO_REP);
      const check = await falProvider.test!();
      clean(check.detail, ECHO_FAL);
      const repCheck = await replicateProvider.test!();
      expect(repCheck.ok).toBe(false);
      clean(repCheck.detail, ECHO_REP);
    } finally {
      setSetting("falKey", "");
      setSetting("replicateToken", "");
    }
  });

  it("an account's refused key: said the way to fix it, and Settings says the provider stopped accepting it", async () => {
    keys.saveAccountKey(A, "fal", ECHO_FAL);
    keys.saveAccountKey(A, "replicate", ECHO_REP);
    const f = await runAsTenant({ kind: "account", id: A }, () => failure(() => falProvider.submit({ generationId: "g", model, route: falRoute, input })));
    expect(f).toBe("fal.ai didn't accept your key. Check it in Settings → Your keys.");
    const r = await runAsTenant({ kind: "account", id: A }, () => failure(() => replicateProvider.submit({ generationId: "g", model, route: repRoute, input })));
    expect(r).toBe("Replicate didn't accept your key. Check it in Settings → Your keys.");
    expect(keys.accountKeyInfo(A).fal?.rejectedAt).toEqual(expect.any(Number));
    expect(keys.accountKeyInfo(A).replicate?.rejectedAt).toEqual(expect.any(Number));
    // A poll that is refused fails with the same words.
    const poll = await runAsTenant({ kind: "account", id: A }, () =>
      failure(() => falProvider.poll({ externalId: "x", meta: { statusUrl: `${fal.url}/fal-ai/flux/requests/x/status` }, route: falRoute, model, createdAt: 0 })),
    );
    expect(poll).toMatch(/didn't accept your key/);
  });

  it("an account's empty balance: top it up", async () => {
    keys.saveAccountKey(A, "fal", BROKE_FAL);
    keys.saveAccountKey(A, "replicate", "r8_brokeToken");
    const f = await runAsTenant({ kind: "account", id: A }, () => failure(() => falProvider.submit({ generationId: "g", model, route: falRoute, input })));
    expect(f).toBe("Your fal.ai balance has run out. Top it up on fal.ai, then run again.");
    const r = await runAsTenant({ kind: "account", id: A }, () => failure(() => replicateProvider.submit({ generationId: "g", model, route: repRoute, input })));
    expect(r).toBe("Your Replicate balance has run out. Top it up on Replicate, then run again.");
    // An empty balance isn't a refused key.
    expect(keys.accountKeyInfo(A).fal?.rejectedAt).toBeUndefined();
  });
});
