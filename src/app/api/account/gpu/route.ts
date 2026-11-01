import { connection } from "next/server";
import { z } from "zod";
import { checkGpuAddress, computerView, GpuError, testGpu } from "@/server/account-gpu";
import { accountGpu, gpuLink, requestAccount, setAccountGpu } from "@/server/auth";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES } from "@/server/account-files";
import { clearAccountLoras } from "@/server/account-loras";
import { forgetComputer } from "@/server/computer/tasks";
import { dropSnapshots } from "@/server/gpu/snapshots";
import { hit } from "@/server/rate";

/**
 * "Your GPU" (public sign-up): the account's own ComfyUI, where its runs go. Either the ComfyUI on the person's own
 * computer, which their Fuobe tab runs ({ mode: "computer" }), or one at a public address (a link). GET says what is
 * connected (never the token; for a computer, what its tab last said about it); PUT connects: a computer at once, a
 * link after checking the address and asking the ComfyUI for /system_stats (`?test=1`: check only); DELETE
 * disconnects (a computer's runs still waiting stop). Accounts only: the owner's ComfyUI is in Settings.
 */
const account = async (request: Request) => requestAccount(request);

const notAccount = () => Response.json({ error: "Log in to connect your GPU." }, { status: 400 });

/** What a computer's tab last said: its GPU, memory, ComfyUI version and port, and whether it is open now. */
const accountComputer = (id: string) => computerView(`acct:${id}`);

export async function GET(request: Request) {
  await connection();
  const a = await account(request);
  if (!a) return notAccount();
  const gpu = accountGpu(a.id);
  if (gpu?.mode === "computer") return Response.json({ gpu: accountComputer(a.id) });
  const link = gpuLink(gpu);
  return Response.json({ gpu: link ? { mode: "link", url: link.url, hasToken: !!link.token } : null });
}

const Body = z.union([z.object({ mode: z.literal("computer") }).strict(), z.object({ mode: z.literal("link").optional(), url: z.string().min(1).max(500), token: z.string().max(500).optional() })]);

export async function PUT(request: Request) {
  const a = await account(request);
  if (!a) return notAccount();
  // Each check makes the server call the address: a few a minute.
  const rate = hit(`gpu:${a.id}`, ACCOUNT_LIMITS.gpuChecksPerMinute, 60_000);
  if (!rate.ok) return Response.json({ error: ACCOUNT_MESSAGES.gpuChecks }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your ComfyUI's address" }, { status: 400 });
  const before = accountGpu(a.id);
  // The ComfyUI on this computer: nothing for the server to reach, so nothing to check here (the tab found it).
  if ("mode" in parsed.data && parsed.data.mode === "computer") {
    if (before?.mode !== "computer") {
      setAccountGpu(a.id, { mode: "computer" });
      clearAccountLoras(a.id);
      dropSnapshots(`acct:${a.id}`);
    }
    return Response.json({ gpu: accountComputer(a.id) });
  }
  const body = parsed.data as { url: string; token?: string };
  try {
    const url = await checkGpuAddress(body.url);
    // A token left empty keeps the saved one when the address is the same.
    const saved = gpuLink(before);
    const token = body.token?.trim() || (saved?.url === url ? saved.token : undefined);
    const info = await testGpu({ url, token });
    if (new URL(request.url).searchParams.get("test") !== "1") {
      setAccountGpu(a.id, { url, token });
      clearAccountLoras(a.id);
      // Runs on the computer stop (saying why): they go to the link from now on.
      if (before?.mode === "computer") forgetComputer(`acct:${a.id}`, "switched");
    }
    return Response.json({ gpu: { mode: "link", url, hasToken: !!token }, info });
  } catch (e) {
    if (e instanceof GpuError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}

export async function DELETE(request: Request) {
  const a = await account(request);
  if (!a) return notAccount();
  setAccountGpu(a.id, null);
  clearAccountLoras(a.id);
  forgetComputer(`acct:${a.id}`);
  return Response.json({ gpu: null });
}
