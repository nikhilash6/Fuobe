import { connection } from "next/server";
import { z } from "zod";
import { requestAccount, accountGpu } from "@/server/auth";
import { accountProviders } from "@/server/account-keys";
import { poolReady } from "@/server/hosted";
import { runOnOf, setRunOn, type RunOnPick } from "@/server/run-on";

/**
 * Where an account's runs go (hosted runs on): this install's GPUs ("site"), its own GPU ("gpu"), or its own fal.ai or
 * Replicate key ("key", for what has a cloud version; `key` names the provider). The Run on list, Settings → Your GPU and
 * the one-time note write it; every later run that names no place follows it, on every device. GET reads it (none: the
 * install's default). Accounts only, each its own. While hosted runs are off this route doesn't exist (404).
 */
const NO_STORE = { "Cache-Control": "no-store" };
const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
const notHere = () => answer(404, { error: "Not found" });

const Body = z
  .object({
    runOn: z.enum(["site", "gpu", "key"]),
    key: z.enum(["fal", "replicate"]).optional(),
  })
  .strict();

const shown = (pick: RunOnPick | null) => (pick ? { runOn: pick.runOn, ...(pick.runKey && { runKey: pick.runKey }) } : { runOn: null });

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (!poolReady()) return notHere();
  const a = requestAccount(request);
  if (!a) return notHere();
  return answer(200, shown(runOnOf(a.id)));
}

export async function PUT(request: Request): Promise<Response> {
  if (!poolReady()) return notHere();
  const a = requestAccount(request);
  if (!a) return notHere();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return answer(400, { error: "Pick where your runs go." });
  const { runOn, key } = parsed.data;
  // Only a place the account has: its GPU connected, its key saved (the provider it names, else its first).
  if (runOn === "gpu" && !accountGpu(a.id))
    return answer(409, {
      error: "Connect your GPU first.",
      code: "connect-gpu",
    });
  let runKey: RunOnPick["runKey"];
  if (runOn === "key") {
    const keys = accountProviders(a.id);
    runKey = key && keys.includes(key) ? key : keys.includes("fal") ? "fal" : keys[0];
    if (!runKey) return answer(409, { error: "Add your key first.", code: "add-key" });
  }
  setRunOn(a.id, { runOn, ...(runKey && { runKey }) });
  return answer(200, shown(runOnOf(a.id)));
}
