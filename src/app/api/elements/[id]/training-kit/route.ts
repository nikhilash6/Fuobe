import { AITK_FAMILIES, type TrainingFamily } from "@/lib/catalog/training";
import { trainingKit } from "@/server/training";

/** Dataset + AI-Toolkit config + README, to train the element's LoRA on any GPU (?family= picks the base; Z-Image Turbo by default). */
export async function GET(req: Request, ctx: RouteContext<"/api/elements/[id]/training-kit">) {
  const { id } = await ctx.params;
  const asked = new URL(req.url).searchParams.get("family") ?? "z-image-turbo";
  if (!AITK_FAMILIES.includes(asked as TrainingFamily)) return Response.json({ error: `AI-Toolkit kits are for ${AITK_FAMILIES.join(", ")}` }, { status: 400 });
  try {
    const kit = await trainingKit(id, asked as TrainingFamily);
    return new Response(new Uint8Array(kit.data), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${kit.name}"` },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
