import { deleteCustomPreset, ShortsError, updateCustomPreset } from "@/server/shorts";
import { PresetPatchSchema, body, handle } from "@/server/shorts-schemas";

export async function PATCH(request: Request, ctx: RouteContext<"/api/shorts/presets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, PresetPatchSchema, "Those preset settings aren't valid");
    return Response.json(updateCustomPreset(id, patch));
  }, request);
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/shorts/presets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!deleteCustomPreset(id)) throw new ShortsError("This preset no longer exists", 404);
    return new Response(null, { status: 204 });
  }, request);
}
