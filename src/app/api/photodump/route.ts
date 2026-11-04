import { connection } from "next/server";
import { z } from "zod";
import { createPhotodump, listUserPacks, previewPhotodump } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";
import { getPack } from "@/lib/catalog/packs";
import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { runToolForAccount, withPoolPrice } from "@/server/tool-runs";

const Body = z
  .object({
    packId: z.string().min(1).max(80),
    engine: z.enum(["cloud", "open"]),
    elementId: z.string().max(40).optional(),
    selfie: z.string().startsWith("/api/files/").max(500).optional(),
    aspectRatio: z.string().max(10).optional(),
    modelId: z.string().max(80).optional(),
    /** Client nonce: a repeat of it (a second click) gets the run the first one started (an account's). */
    requestId: z.string().max(64).optional(),
  })
  .refine((b) => !!b.elementId || !!b.selfie, { message: "Pick a character or add a selfie" });

/** Your own packs (the built-in ones ship with the page). */
export async function GET() {
  await connection();
  return Response.json({ packs: listUserPacks() });
}

/**
 * Generate a photodump: one photo per pack shot, as one batch. `?preview=1` prices it instead
 * (model, photo count, cost, demo, notes, or the error that would stop it).
 *
 * The owner's run as always; an account's from a built-in pack and its own selfie (characters and saved packs are the
 * owner's library), after the checks every tool run gets (src/server/tool-runs.ts); a guest signs up first.
 */
export async function POST(request: Request) {
  const viewer = toolViewer(request);
  const preview = !!new URL(request.url).searchParams.get("preview");
  if (viewer.kind === "guest" && !preview) return guestRun();
  if (viewer.kind === "account" && !preview) {
    const big = bodyTooBig(request);
    if (big) return big;
  }
  const wishes = viewer.kind === "owner" ? {} : await toolWishes(request);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Pick a pack" }, { status: 400 });
  const { requestId, ...input } = parsed.data;
  // Characters and saved packs are the owner's library: a visitor is never told whether one exists.
  if (viewer.kind !== "owner" && (input.elementId || !getPack(input.packId))) return Response.json({ error: input.elementId ? "Character not found" : "That pack no longer exists" }, { status: 404 });
  const start = () => createPhotodump(input);
  if (preview) return Response.json(await withPoolPrice(request, previewPhotodump(input), start, wishes.place));
  if (viewer.kind === "account") {
    return runToolForAccount(request, viewer.account, {
      tool: "photodump",
      files: [input.selfie],
      requestId,
      wishes,
      start,
      ok: (value, gpuWarning) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
    });
  }
  try {
    return Response.json(createPhotodump(input), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
