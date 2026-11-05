import { z } from "zod";
import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { createLockedRun, SignatureSchema } from "@/server/palettes";
import { ClientExtra } from "@/server/request-schema";
import { runToolForAccount } from "@/server/tool-runs";

const Hex = z.string().regex(/^#?[0-9a-fA-F]{6}$/);

/** The image request as the composer builds it (the fields an image studio sends). */
const RequestSchema = z.object({
  feature: z.string().min(1).max(80),
  presetId: z.string().max(120).optional(),
  // A Fuobe Soul look's strength, and the engine an Original runs on (the lock itself is the open engine's).
  presetStrength: z.number().min(0).max(1).optional(),
  engine: z.enum(["open", "cloud"]).optional(),
  modelId: z.string().min(1).max(120),
  op: z.string().max(40).optional(),
  prompt: z.string().max(10_000).optional(),
  negativePrompt: z.string().max(4_000).optional(),
  inputs: z.object({ images: z.array(z.string()).max(14).optional() }).optional(),
  params: z
    .object({
      aspectRatio: z.string().max(20).optional(),
      resolution: z.string().max(20).optional(),
      numOutputs: z.number().int().min(1).max(8).optional(),
      seed: z.number().int().optional(),
      enhancePrompt: z.boolean().optional(),
      palette: z.array(Hex).max(16).optional(),
      styleId: z.string().max(200).optional(),
      extra: ClientExtra.optional(),
    })
    .optional(),
  signature: SignatureSchema,
});

const Body = z.object({
  request: RequestSchema,
  colors: z.array(Hex).min(1).max(16),
  strength: z.number().min(0).max(1).optional(),
  /** Client nonce: a repeat of it (a second click) gets the run the first one started (an account's). */
  requestId: z.string().max(64).optional(),
});

/**
 * Make the images, then recolour each one to the palette (open engine: a chained palette-transfer step). The owner's run
 * as always. An account's runs on this install's GPUs only (hosted runs), with only its own pictures, after the checks
 * every tool run gets (src/server/tool-runs.ts), and with no more pictures at once than a run there makes; on its own
 * GPU or key its colours go in the prompt instead (the composer sends no lock there), so it is refused here as before.
 * A guest signs up first.
 */
export async function POST(request: Request) {
  const viewer = toolViewer(request);
  if (viewer.kind === "guest") return guestRun();
  if (viewer.kind === "account") {
    const big = bodyTooBig(request);
    if (big) return big;
  }
  const wishes = viewer.kind === "account" ? await toolWishes(request) : {};
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  if (viewer.kind === "account") {
    const { request: asked, colors, strength, requestId } = parsed.data;
    const req = asked as Parameters<typeof createLockedRun>[0];
    return runToolForAccount(request, viewer.account, {
      tool: "palette-lock",
      files: asked.inputs?.images ?? [],
      requestId,
      wishes,
      poolOnly: true,
      start: () => createLockedRun(req, colors, strength),
      // Each picture is its own image-and-recolour chain: no more of them than a run there makes at once.
      poolStart: (cap) => () => createLockedRun({ ...req, params: { ...req.params, numOutputs: Math.min(req.params?.numOutputs ?? 1, cap) } }, colors, strength),
      ok: ({ items }, gpuWarning) => Response.json({ items, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
    });
  }
  try {
    const { items } = createLockedRun(parsed.data.request as Parameters<typeof createLockedRun>[0], parsed.data.colors, parsed.data.strength);
    return Response.json({ items }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
