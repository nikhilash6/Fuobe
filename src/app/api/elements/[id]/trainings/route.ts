import { connection } from "next/server";
import { z } from "zod";
import { targetsFor, TRAINING_TARGETS } from "@/lib/catalog/training";
import { getElement } from "@/server/elements";
import { ensureRunner } from "@/server/generations";
import { describeTargets, listTrainings, startTraining } from "@/server/training";

/** The targets this element can train on (each with what stops it, its price and whether it's a demo), and its trainings. */
export async function GET(_req: Request, ctx: RouteContext<"/api/elements/[id]/trainings">) {
  await connection();
  const { id } = await ctx.params;
  ensureRunner(); // the background poller also checks training jobs
  const el = getElement(id);
  return Response.json({
    targets: describeTargets(el ? targetsFor(el.kind) : TRAINING_TARGETS),
    items: listTrainings(id),
  });
}

// consent: the person in the photos agreed (required for a character; SOUL_ID_COPY.consent is the line they confirm).
const Body = z.object({ target: z.string().min(1), consent: z.boolean().optional() });

export async function POST(request: Request, ctx: RouteContext<"/api/elements/[id]/trainings">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick what to train" }, { status: 400 });
  try {
    ensureRunner();
    return Response.json(startTraining(id, parsed.data.target, { consent: parsed.data.consent }), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
