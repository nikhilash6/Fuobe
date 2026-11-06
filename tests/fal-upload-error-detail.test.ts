import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * A refused file upload keeps fal.ai's reason. fal.ai's errors carry `detail` (its DetailError, docs: Queue submit), and
 * the fal client's ApiError.message reads only `message`, else the status text ("Forbidden"). An exhausted balance must
 * read as one: the owner sees fal.ai's words, an account the empty-balance message, not "didn't accept your key".
 * Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = tempDir("fuobe-fal-upload-error-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting } = await import("@/server/settings");
const { runAsTenant } = await import("@/server/tenant");
const { falProvider } = await import("@/server/providers/fal");
const { balanceMessage } = await import("@/lib/your-keys");

let fal: FakeCloud;
let A = "";
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-broke"] = "broke";
  fal.keys["acct-broke"] = "broke";
  setSetting("falKey", "owner-broke");
  auth.setPassword("install password");
  A = auth.createAccount("upload-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-broke");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

describe("a refused fal.ai upload keeps fal.ai's reason", () => {
  it("the owner's run says the balance is exhausted", async () => {
    const e = (await falProvider.prepareFile(Buffer.from("png"), "image/png", "in.png").catch((x: unknown) => x)) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/^fal 403: User is locked\. Reason: Exhausted balance/);
  });

  it("an account's run reads as an empty balance, not a refused key", async () => {
    const e = (await runAsTenant({ kind: "account", id: A }, () => falProvider.prepareFile(Buffer.from("png"), "image/png", "in.png")).catch((x: unknown) => x)) as Error;
    expect(e.message).toBe(balanceMessage("fal"));
  });
});
