import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal.ai's errors carry a machine-readable kind, and fal.ai says to rely on it, never on the words:
 * - Model Errors (https://fal.ai/docs/documentation/model-apis/errors): each detail[] item's `type`
 *   (content_policy_violation, image_too_large...); "Client code should not parse and rely on the msg field".
 * - Request Error Types (https://fal.ai/docs/documentation/model-apis/request-errors): `error_type` (startup_timeout,
 *   runner_disconnected...), "Use error_type to decide whether to retry".
 * A partner's content refusal whose words say nothing of a content checker still reads as a content flag.
 * Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = tempDir("fuobe-fal-error-types-");
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
  A = auth.createAccount("fal-error-types-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-good");
});
afterAll(async () => {
  fal.script = null;
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

async function refusedSubmit(status: number, body: unknown, asAccount: boolean) {
  fal.script = (r) => (r.method === "POST" ? { status, body } : null);
  const model = getModel("nano-banana-pro")!;
  const route = model.routes.find((r) => r.provider === "fal" && r.op === "t2i")!;
  const send = () => falProvider.submit({ generationId: "g", model, route, input: { prompt: "p" } as never });
  const e = (await (asAccount ? runAsTenant({ kind: "account", id: A }, send) : send()).catch((x: unknown) => x)) as Error & { status?: number; said?: string };
  fal.script = null;
  return e;
}

const PARTNER_REFUSAL = { detail: [{ loc: ["body", "prompt"], msg: "Request rejected by the partner.", type: "content_policy_violation", url: "https://docs.fal.ai/errors#content_policy_violation" }] };

// Skipped until the server side lands: src/server/providers/fal.ts describeError (each detail's type, a request's error_type) and src/lib/diagnose.ts (content_policy_violation). It fails without that change.
describe.skip("fal.ai's error kinds are kept", () => {
  it("the owner's 422 names each error's type", async () => {
    const e = await refusedSubmit(422, PARTNER_REFUSAL, false);
    expect(e.message).toBe("fal 422: body.prompt: Request rejected by the partner. (content_policy_violation)");
  });

  it("an account's content_policy_violation reads as a content flag, whatever its words", async () => {
    const e = await refusedSubmit(422, PARTNER_REFUSAL, true);
    expect(diagnoseKey({ stage: "submit", status: e.status, text: e.said ?? e.message }, { provider: "fal" }).cause).toBe("content-flag");
  });

  it("a request error keeps its error_type", async () => {
    const e = await refusedSubmit(500, { detail: "Runner failed", error_type: "runner_server_error" }, false);
    expect(e.message).toBe("fal 500: Runner failed (runner_server_error)");
  });
});
