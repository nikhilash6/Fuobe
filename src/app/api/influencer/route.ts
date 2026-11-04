import { z } from "zod";
import { MAX_CLOTHING, MAX_DIRECTION } from "@/lib/influencer";
import { createInfluencer, previewInfluencer, type InfluencerBody } from "@/server/influencer";
import { refusedRun } from "@/server/connect-refusal";
import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { runToolForAccount, withPoolPrice } from "@/server/tool-runs";

const File = z.string().startsWith("/api/files/").max(500);

const Body = z.object({
  /** Client nonce: a repeat of it (a second click) gets the run the first one started (an account's). */
  requestId: z.string().max(64).optional(),
  engine: z.enum(["cloud", "open"]),
  state: z.record(z.string(), z.unknown()),
  direction: z.string().max(MAX_DIRECTION).optional(),
  start: z.enum(["scratch", "reference", "face"]),
  photo: File.optional(),
  clothing: z.array(File).max(MAX_CLOTHING).optional(),
  modelId: z.string().max(60).optional(),
});

/** What's wrong with a body, in Higgsfield's words where it has them. */
function bodyError(issues: z.core.$ZodIssue[]): string {
  const at = (key: string) => issues.some((i) => i.path[0] === key);
  if (at("engine")) return "Pick Cloud or Open source";
  if (at("direction")) return "Keep the direction under 4,000 characters";
  if (at("clothing")) return issues.some((i) => i.path[0] === "clothing" && i.code === "too_big") ? "You can add up to three clothing references" : "Upload the clothing references again";
  if (at("photo")) return "Upload the photo again";
  if (at("start")) return "Pick how to start: from scratch, from a reference or with your face";
  return "Build your character first";
}

/**
 * AI Influencer builder: a character sheet from the builder's picks — Fuobe Soul in the cloud (Nano Banana Pro or
 * Seedream 5.0 Pro when asked), the Soul Cast sheet workflow on the open engine, each followed by Qwen-Image-Edit 2511
 * for a face, a reference or clothing. `?preview=1` (or POST /api/influencer/estimate) prices it instead.
 *
 * The owner's run as always; an account's with only its own files, after the checks every tool run gets
 * (src/server/tool-runs.ts), on its own GPU or key or on this install's GPUs; a guest signs up first.
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
  if (!parsed.success) return Response.json({ error: bodyError(parsed.error.issues) }, { status: 400 });
  const { requestId, ...body } = parsed.data as InfluencerBody & { requestId?: string };
  const start = () => createInfluencer(body);
  if (preview) return Response.json(await withPoolPrice(request, previewInfluencer(body), start, wishes.place));
  if (viewer.kind === "account") {
    return runToolForAccount(request, viewer.account, {
      tool: "influencer",
      files: [body.photo, ...(body.clothing ?? [])],
      requestId,
      wishes,
      start,
      ok: (value, gpuWarning) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
    });
  }
  try {
    return Response.json(createInfluencer(body), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
