import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal.ai's 403 says why in `type` (Queue API reference, DetailError.type: rejected_key, permission_denied,
 * resource_restricted; the Forbidden answer: "missing permissions, a model restriction on the key, a locked account, or a
 * spending limit"). A key that may not run this model, or that hit a spending limit, isn't a key to replace.
 * Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = tempDir("fuobe-fal-403-reason-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting } = await import("@/server/settings");
const { runAsTenant } = await import("@/server/tenant");
const { falProvider } = await import("@/server/providers/fal");
const { diagnoseKey } = await import("@/lib/diagnose");
const { getModel } = await import("@/lib/catalog");

let fal: FakeCloud;
let A = "";
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-good"] = "good";
  fal.keys["acct-good"] = "good";
  setSetting("falKey", "owner-good");
  auth.setPassword("install password");
  A = auth.createAccount("fal-403-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-good");
});
afterAll(async () => {
  fal.script = null;
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

/** Every submit is refused with fal.ai's 403 DetailError of this `type`. */
async function refusedSubmit(type: string, asAccount: boolean) {
  fal.script = (r) => (r.method === "POST" ? { status: 403, body: { detail: "Forbidden", type } } : null);
  const model = getModel("nano-banana-pro")!;
  const route = model.routes.find((r) => r.provider === "fal" && r.op === "t2i")!;
  const send = () => falProvider.submit({ generationId: "g", model, route, input: { prompt: "p" } as never });
  const e = (await (asAccount ? runAsTenant({ kind: "account", id: A }, send) : send()).catch((x: unknown) => x)) as Error & { status?: number; said?: string };
  fal.script = null;
  return e;
}

describe("fal.ai's 403 keeps its reason", () => {
  it("the owner's error names it", async () => {
    const e = await refusedSubmit("permission_denied", false);
    expect(e.message).toBe("fal 403: Forbidden (permission_denied)");
  });

  it("an account's permission_denied reads as a model its key may not run, not a key to replace", async () => {
    const e = await refusedSubmit("permission_denied", true);
    expect(diagnoseKey({ stage: "submit", status: e.status, text: e.said ?? e.message }, { provider: "fal" }).cause).toBe("key-permission");
  });

  it("an account's resource_restricted (a model restriction, a spending limit) too", async () => {
    const e = await refusedSubmit("resource_restricted", true);
    expect(diagnoseKey({ stage: "submit", status: e.status, text: e.said ?? e.message }, { provider: "fal" }).cause).toBe("key-permission");
  });

  it("rejected_key is still a key to replace", async () => {
    const e = await refusedSubmit("rejected_key", true);
    expect(diagnoseKey({ stage: "submit", status: e.status, text: e.said ?? e.message }, { provider: "fal" }).cause).toBe("key-rejected");
  });
});
