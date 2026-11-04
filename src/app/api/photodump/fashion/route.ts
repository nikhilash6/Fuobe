import { z } from "zod";
import { createFashion, previewFashion, type FashionRun } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";
import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { runToolForAccount, withPoolPrice } from "@/server/tool-runs";

const File = z.string().startsWith("/api/files/").max(500);
const Engine = z.enum(["cloud", "open"]);

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("base"), templateId: z.string().max(80), elementId: z.string().max(40), engine: Engine }),
  z.object({ step: z.literal("outfit"), templateId: z.string().max(80), base: File, garment: File, engine: Engine, modelId: z.string().max(80).optional() }),
  z.object({ step: z.literal("photoset"), templateId: z.string().max(80), dressed: File, engine: Engine, modelId: z.string().max(80).optional() }),
]);

/**
 * Fashion Factory steps: 4 base shots of the character in the template's set, the outfit (try-on),
 * and the photoset (one photo per template shot). `?preview=1` prices a step instead.
 *
 * The owner's run as always; an account's outfit and photoset from its own pictures (the base step reads a character
 * from the owner's library), after the checks every tool run gets (src/server/tool-runs.ts); a guest signs up first.
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
  const raw = (await request.json().catch(() => null)) as { requestId?: unknown } | null;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Template required" }, { status: 400 });
  const input = parsed.data as FashionRun;
  if (viewer.kind !== "owner" && input.step === "base") return Response.json({ error: "Character not found" }, { status: 404 });
  const start = () => createFashion(input);
  if (preview) return Response.json(await withPoolPrice(request, previewFashion(input), start, wishes.place));
  if (viewer.kind === "account") {
    return runToolForAccount(request, viewer.account, {
      tool: "fashion",
      files: input.step === "outfit" ? [input.base, input.garment] : input.step === "photoset" ? [input.dressed] : [],
      requestId: typeof raw?.requestId === "string" && raw.requestId.length <= 64 ? raw.requestId : undefined,
      wishes,
      start,
      ok: (value, gpuWarning) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
    });
  }
  try {
    return Response.json(createFashion(input), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
